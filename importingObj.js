// Vertex shader source code
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

// Fragment shader source code
const fragmentShaderSource = `
    precision mediump float;
    
    uniform vec3 u_color;
    uniform sampler2D u_texture;
    uniform bool u_useTexture;

    varying vec3 v_normal;
    varying vec3 v_surfaceToLight;
    varying vec3 v_surfaceToView;
    varying vec2 v_texcoord;

    
    void main() {
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

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
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
        gl.deleteProgram(program);
        return null;
    }

    return program;
}

async function loadOBJFromFile(filePath) {
  try {
    const response = await fetch(filePath);
    
    if (!response.ok) {
      throw new Error(`Erro HTTP! status: ${response.status}`);
    }
    
    const objText = await response.text();
    
    const result = parseOBJ(objText);
    return result;
  } catch (error) {
    throw error;
  }
}

function loadOBJFromTag(tagId) {
  const objText = document.getElementById(tagId).textContent;
  return parseOBJ(objText);
}

// Simple OBJ parser (vertex + normal + face)
function parseOBJ(text) {
  const positions = [];
  const normals = [];
  const texcoords = [];
  const indices = [];

  const tempVertices = [];
  const tempNormals = [];
  const tempTexcoords = [];

  const lines = text.split('\n');
  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('#') || line === '') continue;

    const parts = line.split(/\s+/);
    const keyword = parts[0];
    const args = parts.slice(1);

    if (keyword === 'v') {
      // Pega apenas os 3 primeiros valores (x, y, z), ignorando cores extras
      tempVertices.push([parseFloat(args[0]), parseFloat(args[1]), parseFloat(args[2])]);
    } else if (keyword === 'vt') {
      // Inverter Y porque OBJ usa origem inferior-esquerda e WebGL usa superior-esquerda
      tempTexcoords.push([parseFloat(args[0]), 1.0 - parseFloat(args[1])]);
    } else if (keyword === 'vn') {
      tempNormals.push([parseFloat(args[0]), parseFloat(args[1]), parseFloat(args[2])]);
    } else if (keyword === 'f') {
      const faceVerts = args.map(f => {
        // Supports v, v/vt, v//vn and v/vt/vn
        const parts = f.split('/');
        const v = parseInt(parts[0]) - 1;
        const vt = parts.length > 1 && parts[1] ? parseInt(parts[1]) - 1 : undefined;
        const n = parts.length > 2 && parts[2] ? parseInt(parts[2]) - 1 : undefined;
        return { v, vt, n };
      });

      for (let i = 1; i < faceVerts.length - 1; i++) {
        const tri = [faceVerts[0], faceVerts[i], faceVerts[i + 1]];
        tri.forEach(({ v, vt, n }) => {
          const vert = tempVertices[v];
          if (!vert) {
            return;
          }
          
          const norm = n !== undefined && tempNormals[n] ? tempNormals[n] : [0, 0, 1];
          const texcoord = vt !== undefined && tempTexcoords[vt] ? tempTexcoords[vt] : [0, 0];
          
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
    const canvas = document.getElementById('glCanvas');
    const gl = canvas.getContext('webgl');

    if (!gl) {
        return;
    }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

    const program = createProgram(gl, vertexShader, fragmentShader);
    gl.useProgram(program);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const normalLocation = gl.getAttribLocation(program, 'a_normal');
    const texcoordLocation = gl.getAttribLocation(program, 'a_texcoord');

    const VertexBuffer = gl.createBuffer();
    const NormalBuffer = gl.createBuffer();
    const TexcoordBuffer = gl.createBuffer();
    const IndexBuffer = gl.createBuffer();

    const colorUniformLocation = gl.getUniformLocation(program, 'u_color');
    const textureUniformLocation = gl.getUniformLocation(program, 'u_texture');
    const useTextureUniformLocation = gl.getUniformLocation(program, 'u_useTexture');

    const modelViewMatrixUniformLocation = gl.getUniformLocation(program,'u_modelMatrix');
    const viewingMatrixUniformLocation = gl.getUniformLocation(program,'u_viewingMatrix');
    const projectionMatrixUniformLocation = gl.getUniformLocation(program,'u_projectionMatrix');
    const inverseTransposeModelViewMatrixUniformLocation = gl.getUniformLocation(program, `u_inverseTransposeModelMatrix`);

    const lightPositionUniformLocation = gl.getUniformLocation(program,'u_lightPosition');
    const viewPositionUniformLocation = gl.getUniformLocation(program,'u_viewPosition');

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    let modelViewMatrix = [];
    let inverseTransposeModelViewMatrix = [];

    let P0 = [0.0,0.0,40.0];
    let Pref = [0.0,0.0,0.0];
    let V = [0.0,1.0,0.0];
    let viewingMatrix = m4.setViewingMatrix(P0,Pref,V);

    gl.uniformMatrix4fv(viewingMatrixUniformLocation,false,viewingMatrix);
    gl.uniform3fv(viewPositionUniformLocation, new Float32Array(P0));
    gl.uniform3fv(lightPositionUniformLocation, new Float32Array([40.0,40.0,40.0]));

    let color = [1.0,0.0,0.0];
    gl.uniform3fv(colorUniformLocation, new Float32Array(color));

    let xw_min = -1.0;
    let xw_max = 1.0;
    let yw_min = -1.0;
    let yw_max = 1.0;
    let z_near = -10.0;
    let z_far = -100.0;

    let projectionMatrix = m4.setOrthographicProjectionMatrix(xw_min,xw_max,yw_min,yw_max,z_near,z_far);

    let rotateX = 0;
    let rotateY = 0;
    let rotateZ = 0;

    const bodyElement = document.querySelector("body");
    bodyElement.addEventListener("keydown",keyDown,false);

    function keyDown(event){
      event.preventDefault();
      switch(event.key){
        case '1':
          projectionMatrix = m4.setOrthographicProjectionMatrix(xw_min,xw_max,yw_min,yw_max,z_near,z_far);
          break;
        case '2':
          projectionMatrix = m4.setPerspectiveProjectionMatrix(xw_min,xw_max,yw_min,yw_max,z_near,z_far);
          break;
        case 'x':
          rotateX = 1;
          rotateY = 0;
          rotateZ = 0;
          break;
        case 'y':
          rotateX = 0;
          rotateY = 1;
          rotateZ = 0;
          break;
        case 'z':
          rotateX = 0;
          rotateY = 0;
          rotateZ = 1;
          break;
      }
    }

    let theta_x = 0.0;
    let theta_y = 0.0;
    let theta_z = 0.0;

    // Função para carregar textura
    function loadTexture(gl, url) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      
      // Textura temporária de 1 pixel enquanto carrega a imagem
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                    new Uint8Array([255, 0, 255, 255]));
      
      const image = new Image();
      image.onload = function() {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      };
      image.src = url;
      return texture;
    }

    // Carregar textura (se tiver)
    const texture = loadTexture(gl, './colormap.png');
    let useTexture = false; // Mude para true se tiver textura

    // Carrega o arquivo OBJ diretamente
    //const objData = await loadOBJFromFile('./OBJ/snowman.obj');
    //const objData = await loadOBJFromFile('./OBJ/reindeer.obj');
    const objData = await loadOBJFromFile('./OBJ/car3.obj');

    let objVertices = new Float32Array(objData.positions);
    let objNormals = new Float32Array(objData.normals);
    let objTexcoords = new Float32Array(objData.texcoords);
    let objIndices = new Uint16Array(objData.indices);
    
    
    if (objTexcoords.length > 0) {
      useTexture = true;
    }
    
    if (objIndices.length === 0) {
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, VertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, objVertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, NormalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, objNormals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, TexcoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, objTexcoords, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, IndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, objIndices, gl.STATIC_DRAW);

    function drawObj(){
      gl.enableVertexAttribArray(positionLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, VertexBuffer);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(normalLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, NormalBuffer);
      gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);

      gl.enableVertexAttribArray(texcoordLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, TexcoordBuffer);
      gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, IndexBuffer);
      
      // Configurar textura
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(textureUniformLocation, 0);
      gl.uniform1i(useTextureUniformLocation, useTexture ? 1 : 0);
      
      modelViewMatrix = m4.identity();
      modelViewMatrix = m4.xRotate(modelViewMatrix,degToRad(theta_x));
      modelViewMatrix = m4.yRotate(modelViewMatrix,degToRad(theta_y));
      modelViewMatrix = m4.zRotate(modelViewMatrix,degToRad(theta_z));

      inverseTransposeModelViewMatrix = m4.transpose(m4.inverse(modelViewMatrix));

      gl.uniformMatrix4fv(modelViewMatrixUniformLocation,false,modelViewMatrix);
      gl.uniformMatrix4fv(inverseTransposeModelViewMatrixUniformLocation,false,inverseTransposeModelViewMatrix);
      gl.uniformMatrix4fv(projectionMatrixUniformLocation,false,projectionMatrix);

      gl.drawElements(gl.TRIANGLES, objIndices.length, gl.UNSIGNED_SHORT, 0);
    }

    let frameCount = 0;
    function drawScene(){
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      

      if (rotateX)
        theta_x += 1;
      if (rotateY)
        theta_y += 1;
      if (rotateZ)
        theta_z += 1;

      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      
      drawObj();
      
      frameCount++;

      requestAnimationFrame(drawScene);
    }

    drawScene();
}

function crossProduct(v1, v2) {
  let result = [
      v1[1] * v2[2] - v1[2] * v2[1],
      v1[2] * v2[0] - v1[0] * v2[2],
      v1[0] * v2[1] - v1[1] * v2[0]
  ];
  return result;
}

function unitVector(v){ 
    let vModulus = vectorModulus(v);
    return v.map(function(x) { return x/vModulus; });
}

function vectorModulus(v){
    return Math.sqrt(Math.pow(v[0],2)+Math.pow(v[1],2)+Math.pow(v[2],2));
}

function radToDeg(r) {
  return r * 180 / Math.PI;
}

function degToRad(d) {
  return d * Math.PI / 180;
}

window.addEventListener('load', main);