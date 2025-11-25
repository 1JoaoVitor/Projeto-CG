const vertexShaderSource = `
    attribute vec3 a_position;
    attribute vec3 a_normal;
    attribute vec2 a_texcoord;
    
    varying vec3 v_normal;
    varying vec3 v_surfaceToLight;
    varying vec3 v_surfaceToView;
    varying vec2 v_texcoord;
    
    uniform mat4 u_modelMatrix;
    uniform mat4 u_viewingMatrix;
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_inverseTransposeModelMatrix;
    
    uniform vec3 u_lightPosition;
    uniform vec3 u_viewPosition;

    void main() {
        gl_Position = u_projectionMatrix * u_viewingMatrix * u_modelMatrix * vec4(a_position,1.0);
        v_normal = normalize(mat3(u_inverseTransposeModelMatrix) * a_normal);
        vec3 surfacePosition = (u_modelMatrix * vec4(a_position, 1.0)).xyz;
        v_surfaceToLight = u_lightPosition - surfacePosition;
        v_surfaceToView = u_viewPosition - surfacePosition;
        v_texcoord = a_texcoord;
    }
`;

const fragmentShaderSource = `
    precision mediump float;
    
    uniform vec3 u_color;
    uniform sampler2D u_texture;
    uniform bool u_useTexture; // Essa flag controla se usa a imagem ou a cor

    varying vec3 v_normal;
    varying vec3 v_surfaceToLight;
    varying vec3 v_surfaceToView;
    varying vec2 v_texcoord;
    
    void main() {
      // Lógica original restaurada:
      vec3 baseColor = u_useTexture ? texture2D(u_texture, v_texcoord).rgb : u_color;
      
      vec3 ambientReflection = baseColor;
      vec3 diffuseReflection = baseColor;
      vec3 specularReflection = vec3(1.0,1.0,1.0);

      gl_FragColor = vec4(diffuseReflection, 1.0);

      vec3 normal = normalize(v_normal);
      vec3 surfaceToLightDirection = normalize(v_surfaceToLight);
      vec3 surfaceToViewDirection = normalize(v_surfaceToView);
      vec3 halfVector = normalize(surfaceToLightDirection + surfaceToViewDirection);

      float light = dot(surfaceToLightDirection,normal);
      float specular = 0.0;
      if (light > 0.0) {
        specular = pow(dot(normal, halfVector), 250.0);
      }

      gl_FragColor.rgb = 0.5*ambientReflection + 0.5*light*diffuseReflection;
      gl_FragColor.rgb += specular*specularReflection;
    }
`;

function crossProduct(v1, v2) {
   return [
      v1[1] * v2[2] - v1[2] * v2[1],
      v1[2] * v2[0] - v1[0] * v2[2],
      v1[0] * v2[1] - v1[1] * v2[0],
   ];
}

function vectorModulus(v) {
   return Math.sqrt(Math.pow(v[0], 2) + Math.pow(v[1], 2) + Math.pow(v[2], 2));
}

function unitVector(v) {
   let mod = vectorModulus(v);
   if (mod === 0) return [0, 0, 0];
   return v.map((x) => x / mod);
}

function degToRad(d) {
   return (d * Math.PI) / 180;
}

function loadTexture(gl, url) {
   const texture = gl.createTexture();
   gl.bindTexture(gl.TEXTURE_2D, texture);
   // Pixel roxo temporário
   gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 0, 255, 255])
   );

   const image = new Image();
   image.onload = function () {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
         gl.TEXTURE_2D,
         0,
         gl.RGBA,
         gl.RGBA,
         gl.UNSIGNED_BYTE,
         image
      );
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(
         gl.TEXTURE_2D,
         gl.TEXTURE_MIN_FILTER,
         gl.LINEAR_MIPMAP_LINEAR
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
   };
   image.src = url;
   return texture;
}

async function fetchObjText(filePath) {
   const response = await fetch(filePath);
   if (!response.ok) throw new Error(`Erro ao carregar ${filePath}`);
   return await response.text();
}

function createShader(gl, type, source) {
   const shader = gl.createShader(type);
   gl.shaderSource(shader, source);
   gl.compileShader(shader);
   if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
   }
   return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
   const program = gl.createProgram();
   gl.attachShader(program, vertexShader);
   gl.attachShader(program, fragmentShader);
   gl.linkProgram(program);
   if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
   }
   return program;
}

function parseOBJ(text) {
   const positions = [];
   const normals = [];
   const texcoords = [];
   const indices = [];
   const tempVertices = [];
   const tempNormals = [];
   const tempTexcoords = [];

   const lines = text.split("\n");
   for (let line of lines) {
      line = line.trim();
      if (line.startsWith("#") || line === "") continue;
      const parts = line.split(/\s+/);
      const keyword = parts[0];
      const args = parts.slice(1);

      if (keyword === "v") {
         tempVertices.push([
            parseFloat(args[0]),
            parseFloat(args[1]),
            parseFloat(args[2]),
         ]);
      } else if (keyword === "vt") {
         tempTexcoords.push([parseFloat(args[0]), 1.0 - parseFloat(args[1])]);
      } else if (keyword === "vn") {
         tempNormals.push([
            parseFloat(args[0]),
            parseFloat(args[1]),
            parseFloat(args[2]),
         ]);
      } else if (keyword === "f") {
         const faceVerts = args.map((f) => {
            const parts = f.split("/");
            const v = parseInt(parts[0]) - 1;
            const vt =
               parts.length > 1 && parts[1]
                  ? parseInt(parts[1]) - 1
                  : undefined;
            const n =
               parts.length > 2 && parts[2]
                  ? parseInt(parts[2]) - 1
                  : undefined;
            return { v, vt, n };
         });
         for (let i = 1; i < faceVerts.length - 1; i++) {
            const tri = [faceVerts[0], faceVerts[i], faceVerts[i + 1]];
            tri.forEach(({ v, vt, n }) => {
               const vert = tempVertices[v];
               if (!vert) return;
               const norm =
                  n !== undefined && tempNormals[n]
                     ? tempNormals[n]
                     : [0, 0, 1];
               const texcoord =
                  vt !== undefined && tempTexcoords[vt]
                     ? tempTexcoords[vt]
                     : [0, 0];
               positions.push(...vert);
               normals.push(...norm);
               texcoords.push(...texcoord);
               indices.push(indices.length);
            });
         }
      }
   }
   return { positions, normals, texcoords, indices };
}

async function main() {
   const canvas = document.getElementById("gameCanvas");
   const gl = canvas.getContext("webgl");
   if (!gl) return;

   const program = createProgram(
      gl,
      createShader(gl, gl.VERTEX_SHADER, vertexShaderSource),
      createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)
   );
   gl.useProgram(program);

   const positionLoc = gl.getAttribLocation(program, "a_position");
   const normalLoc = gl.getAttribLocation(program, "a_normal");
   const texcoordLoc = gl.getAttribLocation(program, "a_texcoord");

   const u_model = gl.getUniformLocation(program, "u_modelMatrix");
   const u_view = gl.getUniformLocation(program, "u_viewingMatrix");
   const u_proj = gl.getUniformLocation(program, "u_projectionMatrix");
   const u_invTrans = gl.getUniformLocation(
      program,
      "u_inverseTransposeModelMatrix"
   );

   const u_textureLoc = gl.getUniformLocation(program, "u_texture");
   const u_useTextureLoc = gl.getUniformLocation(program, "u_useTexture");
   const u_colorLoc = gl.getUniformLocation(program, "u_color");

   gl.uniform3fv(
      gl.getUniformLocation(program, "u_lightPosition"),
      [50, 100, 50]
   );
   gl.enable(gl.DEPTH_TEST);

   const globalTexture = loadTexture(gl, "./colormap.png");

   class GameModel {
      constructor(name, objData, x, y, z, fallbackColor) {
         this.name = name;
         this.position = { x, y, z };
         this.color = fallbackColor;
         this.indicesCount = objData.indices.length;

         this.useTexture = objData.texcoords.length > 0;

         this.posBuffer = gl.createBuffer();
         gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
         gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array(objData.positions),
            gl.STATIC_DRAW
         );

         this.normBuffer = gl.createBuffer();
         gl.bindBuffer(gl.ARRAY_BUFFER, this.normBuffer);
         gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array(objData.normals),
            gl.STATIC_DRAW
         );

         this.texBuffer = gl.createBuffer();
         gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffer);
         gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array(objData.texcoords),
            gl.STATIC_DRAW
         );

         this.idxBuffer = gl.createBuffer();
         gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuffer);
         gl.bufferData(
            gl.ELEMENT_ARRAY_BUFFER,
            new Uint16Array(objData.indices),
            gl.STATIC_DRAW
         );
      }

      draw(viewMatrix, projMatrix, globalRotateY) {
         gl.enableVertexAttribArray(positionLoc);
         gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
         gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);

         gl.enableVertexAttribArray(normalLoc);
         gl.bindBuffer(gl.ARRAY_BUFFER, this.normBuffer);
         gl.vertexAttribPointer(normalLoc, 3, gl.FLOAT, false, 0, 0);

         gl.enableVertexAttribArray(texcoordLoc);
         gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffer);
         gl.vertexAttribPointer(texcoordLoc, 2, gl.FLOAT, false, 0, 0);

         gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuffer);

         if (this.useTexture) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, globalTexture);
            gl.uniform1i(u_textureLoc, 0);
            gl.uniform1i(u_useTextureLoc, true);
         } else {
            gl.uniform1i(u_useTextureLoc, false);
            gl.uniform3fv(u_colorLoc, this.color);
         }

         let model = m4.identity();
         model = m4.translate(
            model,
            this.position.x,
            this.position.y,
            this.position.z
         );
         model = m4.yRotate(model, degToRad(globalRotateY));

         gl.uniformMatrix4fv(u_model, false, model);
         gl.uniformMatrix4fv(u_view, false, viewMatrix);
         gl.uniformMatrix4fv(u_proj, false, projMatrix);
         gl.uniformMatrix4fv(
            u_invTrans,
            false,
            m4.transpose(m4.inverse(model))
         );

         gl.drawElements(gl.TRIANGLES, this.indicesCount, gl.UNSIGNED_SHORT, 0);
      }
   }

   const modelsList = [];
   try {
      const carData = parseOBJ(await fetchObjText("./OBJ/car3.obj"));
      const carData2 = parseOBJ(await fetchObjText("./OBJ/car2.obj"));
      const snowData = parseOBJ(await fetchObjText("./OBJ/snowman.obj"));

      modelsList.push(new GameModel("CarroEsq", carData, -15, 0, 0, [1, 0, 0]));
      modelsList.push(new GameModel("Boneco", snowData, 0, 0, 0, [1, 1, 1]));
      modelsList.push(new GameModel("CarroDir", carData2, 15, 0, 0, [0, 0, 1]));
   } catch (e) {
      console.error("Erro:", e);
   }

   let globalAngle = 0;
   function render() {
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      gl.clearColor(0.2, 0.2, 0.2, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // *** ZOOM AJUSTADO AQUI ***
      const cameraPos = [0, 5, 20];
      let view = m4.setViewingMatrix(cameraPos, [0, 0, 0], [0, 1, 0]);
      gl.uniform3fv(
         gl.getUniformLocation(program, "u_viewPosition"),
         cameraPos
      );

      let projection = m4.setPerspectiveProjectionMatrix(
         -10,
         10,
         -10,
         10,
         -10,
         -200
      );

      //globalAngle += 0.5;

      modelsList.forEach((model) => {
         model.draw(view, projection, globalAngle);
      });

      requestAnimationFrame(render);
   }
   render();
}

window.addEventListener("load", main);
