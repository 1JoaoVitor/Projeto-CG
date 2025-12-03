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

   const lines = text.split("\n");
   for (let line of lines) {
      line = line.trim();
      if (line.startsWith("#") || line === "") continue;

      const parts = line.split(/\s+/);
      const keyword = parts[0];
      const args = parts.slice(1);

      if (keyword === "v") {
         // Pega apenas os 3 primeiros valores (x, y, z), ignorando cores extras
         tempVertices.push([
            parseFloat(args[0]),
            parseFloat(args[1]),
            parseFloat(args[2]),
         ]);
      } else if (keyword === "vt") {
         // Inverter Y porque OBJ usa origem inferior-esquerda e WebGL usa superior-esquerda
         tempTexcoords.push([parseFloat(args[0]), 1.0 - parseFloat(args[1])]);
      } else if (keyword === "vn") {
         tempNormals.push([
            parseFloat(args[0]),
            parseFloat(args[1]),
            parseFloat(args[2]),
         ]);
      } else if (keyword === "f") {
         const faceVerts = args.map((f) => {
            // Supports v, v/vt, v//vn and v/vt/vn
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
               if (!vert) {
                  return;
               }

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

function normalizeModel(objData) {
   let minX = Infinity,
      maxX = -Infinity;
   let minY = Infinity,
      maxY = -Infinity;
   let minZ = Infinity,
      maxZ = -Infinity;

   // 1. Encontra os limites (Bounding Box)
   for (let i = 0; i < objData.positions.length; i += 3) {
      const x = objData.positions[i];
      const y = objData.positions[i + 1];
      const z = objData.positions[i + 2];

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
   }

   // Se o modelo estiver vazio ou corrompido, evita NaNs
   if (minX === Infinity) return;

   // 2. Calcula o centro
   const centerX = (minX + maxX) / 2;
   const centerY = minY; // Pés no chão (Y=0)
   const centerZ = (minZ + maxZ) / 2;

   // 3. Centraliza os vértices
   for (let i = 0; i < objData.positions.length; i += 3) {
      objData.positions[i] -= centerX;
      objData.positions[i + 1] -= centerY;
      objData.positions[i + 2] -= centerZ;
   }
}

async function main() {
   const canvas = document.getElementById("glCanvasPersonagem");
   const gl = canvas.getContext("webgl");

   if (!gl) {
      return;
   }

   const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
   const fragmentShader = createShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentShaderSource
   );

   const program = createProgram(gl, vertexShader, fragmentShader);
   gl.useProgram(program);

   const positionLocation = gl.getAttribLocation(program, "a_position");
   const normalLocation = gl.getAttribLocation(program, "a_normal");
   const texcoordLocation = gl.getAttribLocation(program, "a_texcoord");

   const VertexBuffer = gl.createBuffer();
   const NormalBuffer = gl.createBuffer();
   const TexcoordBuffer = gl.createBuffer();
   const IndexBuffer = gl.createBuffer();

   const colorUniformLocation = gl.getUniformLocation(program, "u_color");
   const textureUniformLocation = gl.getUniformLocation(program, "u_texture");
   const useTextureUniformLocation = gl.getUniformLocation(
      program,
      "u_useTexture"
   );

   const modelViewMatrixUniformLocation = gl.getUniformLocation(
      program,
      "u_modelMatrix"
   );
   const viewingMatrixUniformLocation = gl.getUniformLocation(
      program,
      "u_viewingMatrix"
   );
   const projectionMatrixUniformLocation = gl.getUniformLocation(
      program,
      "u_projectionMatrix"
   );
   const inverseTransposeModelViewMatrixUniformLocation = gl.getUniformLocation(
      program,
      `u_inverseTransposeModelMatrix`
   );

   const lightPositionUniformLocation = gl.getUniformLocation(
      program,
      "u_lightPosition"
   );
   const viewPositionUniformLocation = gl.getUniformLocation(
      program,
      "u_viewPosition"
   );

   gl.enable(gl.DEPTH_TEST);
   gl.clearColor(0.0, 0.0, 0.0, 1.0);
   gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

   let modelViewMatrix = [];
   let inverseTransposeModelViewMatrix = [];

   let P0 = [0.0, 30.0, 30.0];
   let Pref = [0.0, 0.0, 0.0];
   let V = [0.0, 1.0, 0.0];
   let viewingMatrix = m4.setViewingMatrix(P0, Pref, V);

   gl.uniformMatrix4fv(viewingMatrixUniformLocation, false, viewingMatrix);
   gl.uniform3fv(viewPositionUniformLocation, new Float32Array(P0));
   gl.uniform3fv(
      lightPositionUniformLocation,
      new Float32Array([40.0, 40.0, 40.0])
   );

   let color = [1.0, 0.0, 0.0];
   gl.uniform3fv(colorUniformLocation, new Float32Array(color));

   let xw_min = -3.0;
   let xw_max = 3.0;

   const aspect = gl.canvas.width / gl.canvas.height;
   const worldWidth = xw_max - xw_min;
   const worldHeight = worldWidth / aspect;

   let yw_min = -worldHeight / 2;
   let yw_max = worldHeight / 2;

   let z_near = -10.0;
   let z_far = -100.0;

   let projectionMatrix = m4.setOrthographicProjectionMatrix(
      xw_min,
      xw_max,
      yw_min,
      yw_max,
      z_near,
      z_far
   );

   let rotateX = 0;
   let rotateY = 0;
   let rotateZ = 0;

   const bodyElement = document.querySelector("body");
   bodyElement.addEventListener("keydown", keyDown, false);

   const step = 1.0; // Tamanho do passo da rena

   function keyDown(event) {
      // Não previne o default se for F5/F12, mas para jogo previne scroll
      if (isPaused) return;

      if (
         ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].indexOf(
            event.code
         ) > -1
      ) {
         event.preventDefault();
      }

      switch (
         event.key.toLowerCase() // toLowerCase permite usar 'W' ou 'w'
      ) {
         // Controles da Câmera (Existentes)
         case "1":
            projectionMatrix = m4.setOrthographicProjectionMatrix(
               xw_min,
               xw_max,
               yw_min,
               yw_max,
               z_near,
               z_far
            );
            break;
         case "2":
            projectionMatrix = m4.setPerspectiveProjectionMatrix(
               xw_min,
               xw_max,
               yw_min,
               yw_max,
               z_near,
               z_far
            );
            break;

         // --- Controles da Rena (Novos) ---
         case "w":
            player.y += step; // Sobe a "pista" (Vai para o fundo)
            player.rotationY = 180; // Costas para a câmera
            break;
         case "s":
            player.y -= step; // Desce a "pista" (Vem para perto)
            player.rotationY = 0; // Frente para a câmera
            break;
         case "a":
            player.z -= step; // Vai para a esquerda
            player.rotationY = 270; // Vira para esquerda
            break;
         case "d":
            player.z += step; // Vai para a direita
            player.rotationY = 90; // Vira para direita
            break;
      }
   }

   let theta_x = 0.0;
   let theta_y = 0.0;
   let theta_z = 0.0;

   // Array de carros em diferentes pistas/ruas (tipo Crossy Road)
   const cars = [
      // Rua 1 (y = 4) - carros indo para direita
      {
         x: 0,
         y: 4,
         z: -15,
         speed: 4,
         minZ: -15,
         maxZ: 15,
         scale: 0.6,
         direction: 1,
         modelIndex: 0,
      },
      {
         x: 0,
         y: 4,
         z: -5,
         speed: 4,
         minZ: -15,
         maxZ: 15,
         scale: 0.6,
         direction: 1,
         modelIndex: 0,
      },

      // Rua 2 (y = 0) - carros indo para esquerda
      {
         x: 0,
         y: 0,
         z: 15,
         speed: 5,
         minZ: -15,
         maxZ: 15,
         scale: 0.6,
         direction: -1,
         modelIndex: 1,
      },
      {
         x: 0,
         y: 0,
         z: 5,
         speed: 5,
         minZ: -15,
         maxZ: 15,
         scale: 0.6,
         direction: -1,
         modelIndex: 1,
      },

      // Rua 3 (y = -4) - carros indo para direita
      {
         x: 0,
         y: -4,
         z: -10,
         speed: 3.5,
         minZ: -15,
         maxZ: 15,
         scale: 0.6,
         direction: 1,
         modelIndex: 2,
      },
      {
         x: 0,
         y: -4,
         z: 0,
         speed: 3.5,
         minZ: -15,
         maxZ: 15,
         scale: 0.6,
         direction: 1,
         modelIndex: 2,
      },

      {
         x: 0,
         y: 8,
         z: 10,
         speed: 10,
         minZ: -15,
         maxZ: 15,
         scale: 0.6,
         direction: -1,
         modelIndex: 3,
      },
      {
         x: 0,
         y: -8,
         z: 0,
         speed: 3.5,
         minZ: -15,
         maxZ: 15,
         scale: 0.6,
         direction: 1,
         modelIndex: 3,
      },
   ];

   let player = {
      x: 0,
      y: -12, // Posição inicial (abaixo da última rua)
      z: 0,
      scale: 0.55, // Escala (ajuste se a rena ficar muito grande ou pequena)
      rotationY: 0, // Rotação atual
      modelIndex: 5, // Índice no array objFiles (reindeer.obj)
   };

   let lastTime = null;

   // Função para carregar textura
   function loadTexture(gl, url) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);

      // Textura temporária de 1 pixel enquanto carrega a imagem
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

   // Carregar textura (se tiver)
   const texture = loadTexture(gl, "../OBJ/Textures/holiday_colormap.png");
   let useTexture = true; // Ativa textura para todos os modelos

   // Lista de arquivos OBJ para carregar
   const objFiles = [
      "../OBJ/car1.obj",
      "../OBJ/car2.obj",
      "../OBJ/car3.obj",
      "../OBJ/car4.obj",
      "../OBJ/reindeer.obj",
      "../OBJ/snowman.obj",
   ];

   // Carrega todos os modelos OBJ
   const models = [];
   for (const file of objFiles) {
      try {
         const objData = await loadOBJFromFile(file);
         normalizeModel(objData);

         const verticesFloat = new Float32Array(objData.positions);
         const normalsFloat = new Float32Array(objData.normals);
         const texcoordsFloat = new Float32Array(objData.texcoords);
         const indicesUint = new Uint16Array(objData.indices);

         // calcula centro/centroid do modelo (após normalizeModel)
         let cx = 0,
            cy = 0,
            cz = 0;
         let count = 0;
         for (let i = 0; i < verticesFloat.length; i += 3) {
            cx += verticesFloat[i];
            cy += verticesFloat[i + 1];
            cz += verticesFloat[i + 2];
            count++;
         }
         if (count > 0) {
            cx /= count;
            cy /= count;
            cz /= count;
         }

         models.push({
            vertices: verticesFloat,
            normals: normalsFloat,
            texcoords: texcoordsFloat,
            indices: indicesUint,
            center: { x: cx, y: cy, z: cz },
         });
      } catch (error) {
         console.warn(`N\u00e3o foi poss\u00edvel carregar ${file}:`, error);
      }
   }

   if (models.length === 0) {
      console.error("Nenhum modelo foi carregado!");
      return;
   }

   function drawObj(obj) {
      // Obt\u00e9m o modelo correto para este carro
      const modelIndex = obj.modelIndex % models.length; // Garante que n\u00e3o ultrapasse o array
      const model = models[modelIndex];

      // Carrega os buffers do modelo espec\u00edfico
      gl.bindBuffer(gl.ARRAY_BUFFER, VertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, model.vertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, NormalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, model.normals, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(normalLocation);
      gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, TexcoordBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, model.texcoords, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(texcoordLocation);
      gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, IndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, model.indices, gl.STATIC_DRAW);

      // Configurar textura
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(textureUniformLocation, 0);
      gl.uniform1i(useTextureUniformLocation, useTexture ? 1 : 0);

      modelViewMatrix = m4.identity();

      // Escala
      modelViewMatrix = m4.scale(
         modelViewMatrix,
         obj.scale,
         obj.scale,
         obj.scale
      );

      // --- Lógica de Rotação Atualizada ---
      let rotationAngle = 0;
      if (obj.rotationY !== undefined) {
         // Se for o jogador (tem propriedade rotationY), usa ela
         rotationAngle = obj.rotationY;
      } else {
         // Se for carro (tem direction), calcula 90 ou 270
         rotationAngle = obj.direction === 1 ? 90 : 270;
      }
      modelViewMatrix = m4.yRotate(modelViewMatrix, degToRad(rotationAngle));
      // ------------------------------------

      modelViewMatrix = m4.translate(modelViewMatrix, obj.z, obj.y, obj.x);

      // Aplica rotações globais da câmera/cena
      // modelViewMatrix = m4.xRotate(modelViewMatrix, degToRad(theta_x));
      // modelViewMatrix = m4.yRotate(modelViewMatrix, degToRad(theta_y));
      // modelViewMatrix = m4.zRotate(modelViewMatrix, degToRad(theta_z));

      // Aplica a translação do carro (Y = pista, Z = movimento horizontal)

      inverseTransposeModelViewMatrix = m4.transpose(
         m4.inverse(modelViewMatrix)
      );

      gl.uniformMatrix4fv(
         modelViewMatrixUniformLocation,
         false,
         modelViewMatrix
      );
      gl.uniformMatrix4fv(
         inverseTransposeModelViewMatrixUniformLocation,
         false,
         inverseTransposeModelViewMatrix
      );
      gl.uniformMatrix4fv(
         projectionMatrixUniformLocation,
         false,
         projectionMatrix
      );

      gl.drawElements(gl.TRIANGLES, model.indices.length, gl.UNSIGNED_SHORT, 0);
   }

   let isPaused = false;

   const pauseBtn = document.getElementById("pauseBtn");
   pauseBtn.addEventListener("click", () => {
      isPaused = !isPaused;
      pauseBtn.textContent = isPaused ? "RESUME" : "PAUSE";

      // Opcional: tirar o foco do botão para que o 'Espaço' não ative o botão novamente
      pauseBtn.blur();
   });

   // PONTUAÇÃO
   const initialY = -12.0; // Mesma posição inicial do player definida no objeto player
   let maxDistanceY = initialY; // Guarda a posição mais longe que a rena já chegou

   const scoreElement = document.getElementById("score");

   // --- VARIÁVEIS DO AUTO-SCROLL ---
   // A câmera começa na mesma posição Y inicial do jogador (-12 atualmente)
   let cameraY = -12.0;

   // Velocidade da câmera (unidades por segundo)
   // Ajuste este valor: 1.0 é lento, 3.0 é rápido/difícil
   const scrollSpeed = 0.2;

   let frameCount = 0;
   function drawScene(time) {
      // --- LÓGICA DE PAUSE ---
      if (isPaused) {
         // Atualizamos o lastTime para o tempo atual, assim
         // quando despausar, o 'dt' será pequeno e não haverá salto temporal.
         lastTime = time;

         // Requisita o próximo frame (loop continua rodando, mas sem fazer nada)
         requestAnimationFrame(drawScene);
         return; // Sai da função aqui, impedindo qualquer movimento
      }

      if (!lastTime) lastTime = time;
      const dt = (time - lastTime) / 1000.0; // segundos
      lastTime = time;

      // --- LÓGICA DE PONTUAÇÃO ---

      // 1. Verifica se a posição atual é maior que a máxima alcançada
      if (player.y > maxDistanceY) {
         maxDistanceY = player.y;

         // 2. Calcula os pontos: Distância Percorrida / Tamanho do Passo
         // Math.floor remove decimais minúsculos de erro de flutuação
         const currentScore = Math.floor((maxDistanceY - initialY) / step);

         // 3. Atualiza o HTML
         scoreElement.textContent = currentScore;
      }

      //proporções do mundo
      const worldWidth = 6.0;
      const aspect = gl.canvas.width / gl.canvas.height;
      const worldHeight = worldWidth / aspect;

      cameraY += scrollSpeed * dt;

      //Verifica o limite de 1/3 da tela
      // O centro da tela (TargetY) é "cameraY + lookAhead".
      // A base da tela é "CenterY - worldHeight/2".
      // A linha de 1/3 é "Base + worldHeight/3".
      // Simplificando a matemática: Se o jogador passar dessa linha, ajustamos o cameraY.

      const lookAhead = 2.0;

      // Essa fórmula garante que o jogador fique na linha de 1/3 visualmente
      // CenterY = PlayerY + H/6 (H/6 é a diferença entre o meio e o 1/3 inferior)
      // Como CenterY = cameraY + lookAhead, isolamos o cameraY:
      const minCameraYForPlayer = player.y + worldHeight / 6.0 - lookAhead;

      // Se o scroll automático estiver atrasado em relação ao jogador, puxa a câmera
      if (cameraY < minCameraYForPlayer) {
         cameraY = minCameraYForPlayer;
      }

      let targetX = 0.0; //player.z;
      let targetY = cameraY + lookAhead;
      let targetZ = player.x;

      let Pref = [targetX, targetY, targetZ];

      // 2. Onde a câmera está? (Eye/Position)
      // Mantemos o deslocamento original (offset) de [0, 30, 30] em relação ao alvo
      // Isso preserva o ângulo de 45 graus e a distância
      let P0 = [
         targetX + 0.0, // Segue lateralmente
         targetY + 30.0, // Mantém altura/distância Y
         targetZ + 30.0, // Mantém profundidade Z
      ];

      // 3. Recalcula a matriz
      // Nota: 'V' (vetor up [0,1,0]) deve estar acessível no escopo da main
      let viewingMatrix = m4.setViewingMatrix(P0, Pref, V);

      // 4. Envia para a GPU
      gl.uniformMatrix4fv(viewingMatrixUniformLocation, false, viewingMatrix);

      // Atualiza a posição da câmera para o cálculo de brilho especular (importante!)
      gl.uniform3fv(viewPositionUniformLocation, new Float32Array(P0));

      // (Opcional) Faz a luz acompanhar o jogador para o mundo não ficar escuro lá na frente
      let lightPos = [targetX + 40.0, targetY + 40.0, targetZ + 40.0];
      gl.uniform3fv(lightPositionUniformLocation, new Float32Array(lightPos));

      // ----------------------------------

      // Atualiza posição de todos os carros
      cars.forEach((car) => {
         car.z += car.speed * car.direction * dt;

         // Loop infinito: verifica movimento real (speed * direction)
         const velocidadeReal = car.speed * car.direction;
         if (velocidadeReal > 0 && car.z > car.maxZ) {
            car.z = car.minZ;
         } else if (velocidadeReal < 0 && car.z < car.minZ) {
            car.z = car.maxZ;
         }
      });

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      if (rotateX) theta_x += 1;
      if (rotateY) theta_y += 1;
      if (rotateZ) theta_z += 1;

      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

      // Desenha todos os carros
      cars.forEach((car) => {
         drawObj(car);
      });

      drawObj(player);

      frameCount++;

      requestAnimationFrame(drawScene);
   }

   // Inicia a animação (requestAnimationFrame passa o timestamp)
   requestAnimationFrame(drawScene);
}

function crossProduct(v1, v2) {
   let result = [
      v1[1] * v2[2] - v1[2] * v2[1],
      v1[2] * v2[0] - v1[0] * v2[2],
      v1[0] * v2[1] - v1[1] * v2[0],
   ];
   return result;
}

function unitVector(v) {
   let vModulus = vectorModulus(v);
   return v.map(function (x) {
      return x / vModulus;
   });
}

function vectorModulus(v) {
   return Math.sqrt(Math.pow(v[0], 2) + Math.pow(v[1], 2) + Math.pow(v[2], 2));
}

function radToDeg(r) {
   return (r * 180) / Math.PI;
}

function degToRad(d) {
   return (d * Math.PI) / 180;
}

window.addEventListener("load", main);
