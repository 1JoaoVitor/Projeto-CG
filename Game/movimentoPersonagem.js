// --- Vertex Shader: Agora passa a Posição no Mundo (World Position) ---
const vertexShaderSource = `
    attribute vec3 a_position;
    attribute vec3 a_normal;
    attribute vec2 a_texcoord;
    
    varying vec3 v_normal;
    varying vec3 v_surfacePosition; 
    varying vec3 v_viewPosition;    // Posição da câmera
    varying vec2 v_texcoord;
    
    uniform mat4 u_modelMatrix;
    uniform mat4 u_viewingMatrix;
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_inverseTransposeModelMatrix;
    
    uniform vec3 u_viewPosition;

    void main() {
        vec4 worldPosition = u_modelMatrix * vec4(a_position, 1.0);
        gl_Position = u_projectionMatrix * u_viewingMatrix * worldPosition;
        
        v_surfacePosition = worldPosition.xyz;
        v_normal = normalize(mat3(u_inverseTransposeModelMatrix) * a_normal);
        v_viewPosition = u_viewPosition;
        v_texcoord = a_texcoord;
    }
`;

// --- Fragment Shader: Suporte a Múltiplos Spotlights (Faróis) ---
const fragmentShaderSource = `
    precision mediump float;
    
    uniform vec3 u_color;
    uniform sampler2D u_texture;
    uniform bool u_useTexture;

    // Luz Global (Sol)
    uniform vec3 u_lightPosition; 

    // Múltiplos Faróis (Spotlights)
    // Vamos suportar até 4 faróis (2 carros mais próximos)
    #define MAX_SPOTLIGHTS 4
    uniform vec3 u_spotLightPos[MAX_SPOTLIGHTS];
    uniform vec3 u_spotLightDir[MAX_SPOTLIGHTS];
    uniform vec3 u_spotLightColor[MAX_SPOTLIGHTS];
    uniform float u_spotLightCutoff; // Ângulo do cone

    varying vec3 v_normal;
    varying vec3 v_surfacePosition;
    varying vec3 v_viewPosition;
    varying vec2 v_texcoord;

    void main() {
      vec3 baseColor = u_useTexture ? texture2D(u_texture, v_texcoord).rgb : u_color;
      vec3 normal = normalize(v_normal);
      vec3 viewDir = normalize(v_viewPosition - v_surfacePosition);

      // --- 1. LUZ AMBIENTE (Base) ---
      vec3 ambient = 0.3 * baseColor; 

      // --- 2. LUZ DIRECIONAL (Sol) ---
      vec3 sunDir = normalize(u_lightPosition - v_surfacePosition);
      float sunDiff = max(dot(normal, sunDir), 0.0);
      vec3 diffuse = sunDiff * baseColor * 0.6; // 0.6 = Intensidade do sol

      // Especular do Sol
      vec3 halfVector = normalize(sunDir + viewDir);
      float sunSpec = pow(max(dot(normal, halfVector), 0.0), 50.0);
      vec3 specular = vec3(0.3) * sunSpec; // Brilho suave

      // --- 3. SPOTLIGHTS (Faróis) ---
      vec3 spotLightEffect = vec3(0.0);

      for(int i = 0; i < MAX_SPOTLIGHTS; i++) {
          // Se a cor for preta, a luz está desligada
          if(length(u_spotLightColor[i]) < 0.01) continue;

          vec3 lightDir = normalize(u_spotLightPos[i] - v_surfacePosition);
          
          // Cálculo do Cone (Spotlight)
          // theta é o ângulo entre a direção da luz e a direção do ponto
          float theta = dot(lightDir, normalize(-u_spotLightDir[i]));
          
          if(theta > u_spotLightCutoff) {
              // Distância para atenuação (luz fica fraca longe)
              float distance = length(u_spotLightPos[i] - v_surfacePosition);
              float attenuation = 1.0 / (1.0 + 0.09 * distance + 0.032 * (distance * distance));
              
              // Suavização da borda do farol
              float epsilon = 0.1;
              float intensity = smoothstep(u_spotLightCutoff, u_spotLightCutoff + epsilon, theta);
              
              // Diffuse do Farol
              float diff = max(dot(normal, lightDir), 0.0);
              spotLightEffect += u_spotLightColor[i] * diff * attenuation * intensity * 2.0; // 2.0 = Força do farol
          }
      }

      gl_FragColor = vec4(ambient + diffuse + specular + spotLightEffect, 1.0);
    }
`;

// A versão original do m4.js estava invertendo os eixos e causando tela preta.
if (typeof m4 !== "undefined") {
   m4.setPerspectiveProjectionMatrix = function (
      xw_min,
      xw_max,
      yw_min,
      yw_max,
      z_near,
      z_far
   ) {
      return [
         (2 * z_near) / (xw_max - xw_min),
         0,
         0,
         0,
         0,
         (2 * z_near) / (yw_max - yw_min),
         0,
         0,
         (xw_max + xw_min) / (xw_max - xw_min),
         (yw_max + yw_min) / (yw_max - yw_min),
         -(z_far + z_near) / (z_far - z_near),
         -1,
         0,
         0,
         -(2 * z_near * z_far) / (z_far - z_near),
         0,
      ];
   };
}

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

   // Uniforms de Iluminação
   const lightPositionUniformLocation = gl.getUniformLocation(
      program,
      "u_lightPosition"
   );
   const viewPositionUniformLocation = gl.getUniformLocation(
      program,
      "u_viewPosition"
   );

   // --- UNIFORMS PARA SPOTLIGHTS (Faróis) ---
   const MAX_SPOTLIGHTS = 4;
   const spotLightPosLocs = [];
   const spotLightDirLocs = [];
   const spotLightColorLocs = [];
   const spotLightCutoffLoc = gl.getUniformLocation(
      program,
      "u_spotLightCutoff"
   );

   for (let i = 0; i < MAX_SPOTLIGHTS; i++) {
      spotLightPosLocs.push(
         gl.getUniformLocation(program, `u_spotLightPos[${i}]`)
      );
      spotLightDirLocs.push(
         gl.getUniformLocation(program, `u_spotLightDir[${i}]`)
      );
      spotLightColorLocs.push(
         gl.getUniformLocation(program, `u_spotLightColor[${i}]`)
      );
   }

   // Define o ângulo do farol (cos(30 graus) = ~0.86)
   gl.uniform1f(spotLightCutoffLoc, 0.9); // Quanto mais perto de 1, mais fechado o foco

   gl.enable(gl.DEPTH_TEST);
   gl.clearColor(0.0, 0.0, 0.0, 1.0);
   gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

   let modelViewMatrix = [];
   let inverseTransposeModelViewMatrix = [];

   // CONFIGURAÇÃO INICIAL DA CÂMERA
   // P0: Posição do olho (Câmera)
   // Pref: Ponto de referência (Para onde olha)
   // V: Vetor "Up" (Cabeça para cima)

   // Agora Y é CIMA. X é FRENTE.
   // Começamos olhando para o início (X=0, Z=0).
   // Câmera posicionada atrás (-X) e acima (+Y).

   let P0 = [-20.0, 30.0, 0.0];
   let Pref = [10.0, 0.0, 0.0];
   let V = [0.0, 1.0, 0.0];
   let viewingMatrix = m4.setViewingMatrix(P0, Pref, V);

   gl.uniformMatrix4fv(viewingMatrixUniformLocation, false, viewingMatrix);
   gl.uniform3fv(viewPositionUniformLocation, new Float32Array(P0));
   gl.uniform3fv(
      lightPositionUniformLocation,
      new Float32Array([10.0, 50.0, 20.0])
   );

   let color = [1.0, 0.0, 0.0];
   gl.uniform3fv(colorUniformLocation, new Float32Array(color));

   let xw_min = -4.0;
   let xw_max = 4.0;

   const aspect = gl.canvas.width / gl.canvas.height;
   const worldWidth = xw_max - xw_min;
   const worldHeight = worldWidth / aspect;

   let yw_min = -worldHeight / 2;
   let yw_max = worldHeight / 2;

   let z_near = 0.0;
   let z_far = -50.0;

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

   // --- ESTADOS DE CÂMERA E PROJEÇÃO ---
   let projectionMode = "ortho"; // 'ortho' ou 'perspective'
   let cameraMode = 0; // 0: Padrão, 1: Topo

   // Configurações para Perspectiva (Field of View simulado)
   // Precisamos de planos 'near' positivos para perspectiva funcionar matematicamente bem
   const persp_near = 1.0;
   const persp_far = 200.0;

   // Configurações para Ortográfica (Zoom ajustado)
   // O z_near/far aqui funciona diferente, é uma "caixa" de recorte
   const ortho_near = 100.0;
   const ortho_far = -500.0;

   // Função para atualizar a matriz de projeção baseada no estado atual
   function updateProjection() {
      const aspect = gl.canvas.width / gl.canvas.height;

      if (projectionMode === "ortho") {
         // Mantemos o zoom que definimos antes (-4 a 4)
         let width = 8.0;
         let height = width / aspect;

         projectionMatrix = m4.setOrthographicProjectionMatrix(
            -width / 2,
            width / 2,
            -height / 2,
            height / 2,
            ortho_near,
            ortho_far
         );
      } else {
         // Perspectiva: A janela (xw_min/max) é definida NO PLANO NEAR.
         // Valores pequenos aqui dão um FOV maior (grande angular).
         let width = 1.0;
         let height = width / aspect;

         projectionMatrix = m4.setPerspectiveProjectionMatrix(
            -width / 2,
            width / 2,
            -height / 2,
            height / 2,
            persp_near,
            persp_far
         );
      }
   }

   // Chama uma vez para iniciar
   updateProjection();

   const bodyElement = document.querySelector("body");
   bodyElement.addEventListener("keydown", keyDown, false);

   const step = 1.0; // Tamanho do passo da rena

   function keyDown(event) {
      // Não previne o default se for F5/F12, mas para jogo previne scroll
      if (event.repeat) return;

      const boundaryLimit = Math.floor(TERRAIN_WIDTH / 4) + 1;

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
            projectionMode = "ortho";
            updateProjection();
            console.log("Modo: Ortográfico");
            break;
         case "2":
            projectionMode = "perspective";
            updateProjection();
            console.log("Modo: Perspectiva");
            break;

         // --- TROCA DE CÂMERA (Tecla C) ---
         case "c":
            cameraMode = (cameraMode + 1) % 2;
            console.log("Câmera:", cameraMode);
            break;

         case "w":
            const newXForward = player.x + step;
            if (!checkCollisionWithTrees(newXForward, player.z)) {
               player.x = newXForward;
            }
            player.rotationY = 90;
            break;

         case "s":
            const newXBackward = player.x - step;
            if (!checkCollisionWithTrees(newXBackward, player.z)) {
               player.x = newXBackward;
            }
            player.rotationY = 270;
            break;

         case "a":
            const newZLeft = player.z - step;
            if (
               newZLeft >= -boundaryLimit &&
               !checkCollisionWithTrees(player.x, newZLeft)
            ) {
               player.z = newZLeft;
            }
            player.rotationY = 180;
            break;

         case "d":
            const newZRight = player.z + step;
            if (
               newZRight <= boundaryLimit &&
               !checkCollisionWithTrees(player.x, newZRight)
            ) {
               player.z = newZRight;
            }
            player.rotationY = 0;
            break;
      }
   }

   let theta_x = 0.0;
   let theta_y = 0.0;
   let theta_z = 0.0;

   // Array de carros em diferentes pistas/ruas (tipo Crossy Road)
   let cars = [];

   let trees = [];

   let player = {
      x: -5,
      y: 0,
      z: 0,
      scale: 0.55, // Escala (ajuste se a rena ficar muito grande ou pequena)
      rotationY: 90, // Rotação atual
      modelIndex: 5, // Índice no array objFiles (reindeer.obj)
   };

   // --- VARIÁVEIS DO MAPA ---
   const terrainRows = []; // Lista que guarda as linhas ativas (rua ou grama)
   const ROW_DEPTH = 1.0; // Profundidade de cada linha (igual ao 'step' do player)
   const TERRAIN_WIDTH = 31; // Quantos blocos de largura (ímpar para centralizar em 0)
   //talvez mudar para 51 resolva a cãmera perspectiva

   const DRAW_DISTANCE = 40; // Quantas linhas desenhar à frente/atrás

   // Índices dos modelos no array 'models' (ajuste se a ordem mudar)
   const MODEL_GRASS = 6;
   const MODEL_ROAD = 7;

   //função de colisão com as ávrores
   function checkCollisionWithTrees(newX, newZ) {
      const COLLISION_SIZE = 0.5; // Meio "bloco" para cada lado

      return trees.some((tree) => {
         return (
            Math.abs(tree.x - newX) < COLLISION_SIZE &&
            Math.abs(tree.z - newZ) < COLLISION_SIZE
         );
      });
   }

   function checkCollisionWithCars(newX, newZ) {
      const COLLISION_SIZE = 0.7; // Meio "bloco" para cada lado

      return cars.some((car) => {
         return (
            Math.abs(car.x - newX) < COLLISION_SIZE &&
            Math.abs(car.z - newZ) < COLLISION_SIZE
         );
      });
   }

   function gameOver() {
      isPaused = true;
      isGameOver = true;

      // Atualiza a pontuação no modal
      finalScoreElement.textContent = scoreElement.textContent;

      // Mostra o modal
      gameOverModal.classList.remove("hidden");
   }

   function restartGame() {
      // 1. Resetar flags
      isPaused = false;
      isGameOver = false;

      // 2. Resetar posição do jogador
      player.x = -5;
      player.z = 0;
      player.rotationY = 90;

      // 3. Resetar câmera
      cameraX = -12.0;

      // 4. Resetar pontuação
      maxDistanceX = initialX;
      scoreElement.textContent = "0";

      // 5. Limpar arrays
      trees = [];
      cars = [];
      terrainRows.length = 0;

      // 6. Reinicializar terreno
      initTerrain(-12);

      // 7. Esconder o modal
      gameOverModal.classList.add("hidden");

      // 8. Resetar tempo
      lastTime = null;
   }

   // Função que cria uma nova linha lógica
   function createRow(xPosition) {
      // Lógica simples: aleatório, mas garantindo que o início (onde o player nasce) seja seguro
      let type = "grass";
      let roadDirection = null; // -1 (esquerda) ou 1 (direita)
      let roadSpeed = null;

      // Se estiver longe do início, chance de ser rua
      // (Ajuste a lógica aqui para criar padrões mais complexos)
      if (xPosition > -5 && Math.random() < 0.4) {
         type = "road";
      }

      if (type === "road") {
         roadDirection = Math.random() < 0.5 ? -1 : 1;
         roadSpeed = 3 + Math.random() * 7; // Velocidade aleatória 3-10
      }

      return {
         x: xPosition,
         type: type,
         modelIndex: type === "grass" ? MODEL_GRASS : MODEL_ROAD,
         direction: roadDirection,
         speed: roadSpeed,
         cars: [],
      };
   }

   function spawnTreesOnRow(row) {
      if (row.type !== "grass") return; // Só spawna em grama

      const halfWidth = Math.floor(TERRAIN_WIDTH / 2);

      // Para cada posição Z (largura), chance de spawnar árvore
      for (let zOffset = -halfWidth; zOffset <= halfWidth; zOffset++) {
         // Se estiver muito perto de (-5, 0), não cria árvore.
         if (Math.abs(row.x - -5) < 3.0 && Math.abs(zOffset * 1.0) < 3.0) {
            continue;
         }

         if (Math.random() < 0.15) {
            // 15% de chance por tile
            // Randomiza entre as 5 árvores (índices 8-12)
            const randomTreeIndex = 8 + Math.floor(Math.random() * 5);

            trees.push({
               x: row.x,
               y: 0,
               z: zOffset * 1.0,
               scale: 0.8, // Ajuste o tamanho
               modelIndex: randomTreeIndex,
            });
         }
      }
   }

   function spawnCarsOnRow(row) {
      if (row.type !== "road") return; // Só spawna em ruas

      const halfWidth = Math.floor(TERRAIN_WIDTH / 2);
      const MIN_DISTANCE = 3.0; // Distância mínima entre carros

      // Tenta spawnar alguns carros (2-4 por rua)
      const numCars = Math.floor(Math.random() * 3) + 2;

      for (let i = 0; i < numCars; i++) {
         // Posição Z aleatória
         const randomZ = Math.random() * (halfWidth * 2) - halfWidth;

         // VERIFICAÇÃO DE COLISÃO: Checa se já existe carro próximo
         const tooClose = cars.some((car) => {
            return car.x === row.x && Math.abs(car.z - randomZ) < MIN_DISTANCE;
         });

         if (!tooClose) {
            // Escolhe modelo de carro aleatório (índices 0-3)
            const randomCarModel = Math.floor(Math.random() * 4);

            cars.push({
               x: row.x,
               y: 0,
               z: randomZ,
               speed: row.speed, // Usa a velocidade da rua
               direction: row.direction, // Usa a direção da rua
               minZ: -halfWidth,
               maxZ: halfWidth,
               scale: 0.6,
               modelIndex: randomCarModel,
            });
         }
      }
   }

   // Função para inicializar o mapa ao redor do jogador
   function initTerrain(startX) {
      for (let i = -10; i < DRAW_DISTANCE; i++) {
         const x = startX + i * ROW_DEPTH;
         const newRow = createRow(x);
         terrainRows.push(newRow);
         spawnTreesOnRow(newRow);
         spawnCarsOnRow(newRow);
      }
   }

   // Função chamada a cada frame para criar chão novo e remover o velho
   function updateTerrain(currentCameraX) {
      // 1. Remover linhas que ficaram muito para trás
      // Limite inferior (atrás da câmera)
      const removeThreshold = currentCameraX - 15.0;

      while (terrainRows.length > 0 && terrainRows[0].x < removeThreshold) {
         terrainRows.shift(); // Remove a primeira linha (mais antiga)
      }

      // removendo arvores e carros fora da camera
      trees = trees.filter((tree) => tree.x >= removeThreshold);
      cars = cars.filter((car) => car.x >= removeThreshold);
      // 2. Adicionar linhas novas à frente
      // Pega a posição Y da última linha gerada
      let lastX =
         terrainRows.length > 0 ? terrainRows[terrainRows.length - 1].x : 0;

      // Limite superior (à frente da câmera)
      const addThreshold = currentCameraX + DRAW_DISTANCE;

      while (lastX < addThreshold) {
         lastX += ROW_DEPTH;
         const newRow = createRow(lastX);
         terrainRows.push(newRow);
         spawnTreesOnRow(newRow);
         spawnCarsOnRow(newRow);
      }
   }

   // Função de renderização específica para o terreno

   // ===== OTIMIZAÇÃO 3: RENDERIZAÇÃO DE TERRENO EM LOTE =====
   // ===== OTIMIZAÇÃO 3: RENDERIZAÇÃO DE TERRENO EM LOTE (CORRIGIDA) =====
   // ===== OTIMIZAÇÃO 3: RENDERIZAÇÃO DE TERRENO COM TEXTURA =====
   function drawTerrain() {
      const halfWidth = Math.floor(TERRAIN_WIDTH / 2);

      const grassTiles = [];
      const roadTiles = [];

      for (const row of terrainRows) {
         for (let zOffset = -halfWidth; zOffset <= halfWidth; zOffset++) {
            const transform = {
               x: row.x,
               y: -0.01,
               z: zOffset * 1.0,
               scale: 1.0, // Se precisar ajustar o tamanho do tile, mude aqui
            };

            if (row.modelIndex === MODEL_GRASS) {
               grassTiles.push(transform);
            } else {
               roadTiles.push(transform);
            }
         }
      }

      // Função auxiliar para desenhar um lote (Batch) com Textura
      function drawBatch(modelIndex, tiles) {
         if (tiles.length === 0) return;

         const buffers = modelBuffers[modelIndex % models.length];

         // 1. Liga geometria
         gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertexBuffer);
         gl.enableVertexAttribArray(positionLocation);
         gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

         gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normalBuffer);
         gl.enableVertexAttribArray(normalLocation);
         gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);

         gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texcoordBuffer);
         gl.enableVertexAttribArray(texcoordLocation);
         gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 0, 0);

         gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indexBuffer);

         // 2. CONFIGURAÇÃO DE TEXTURA (A Mudança Principal)
         // Define a cor como BRANCO para não alterar as cores originais da imagem
         gl.uniform3fv(colorUniformLocation, new Float32Array([1.0, 1.0, 1.0]));

         // Ativa a textura
         gl.activeTexture(gl.TEXTURE0);
         gl.bindTexture(gl.TEXTURE_2D, texture); // Usa a textura global carregada
         gl.uniform1i(textureUniformLocation, 0);

         // Diz ao shader: "Sim, use a textura!"
         gl.uniform1i(useTextureUniformLocation, 1);

         // 3. Loop de Desenho
         for (const tile of tiles) {
            let modelViewMatrix = m4.identity();
            // modelViewMatrix = m4.scale(modelViewMatrix, tile.scale, tile.scale, tile.scale);
            modelViewMatrix = m4.translate(
               modelViewMatrix,
               tile.x,
               tile.y,
               tile.z
            );

            let inverseTransposeModelViewMatrix = m4.transpose(
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

            gl.drawElements(
               gl.TRIANGLES,
               buffers.indexCount,
               gl.UNSIGNED_SHORT,
               0
            );
         }
      }

      // Agora chamamos o batch sem precisar passar cores manuais
      drawBatch(MODEL_GRASS, grassTiles);
      drawBatch(MODEL_ROAD, roadTiles);
   }

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
      "../OBJ/grass.obj",
      "../OBJ/road.obj",
      "../OBJ/tree1.obj",
      "../OBJ/tree2.obj",
      "../OBJ/tree3.obj",
      "../OBJ/tree4.obj",
      "../OBJ/tree5.obj",
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

   // ===== OTIMIZAÇÃO 1: BUFFERS PERMANENTES =====
   // Criar buffers WebGL permanentes para cada modelo
   const modelBuffers = models.map((model) => {
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, model.vertices, gl.STATIC_DRAW);

      const nbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
      gl.bufferData(gl.ARRAY_BUFFER, model.normals, gl.STATIC_DRAW);

      const tbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, tbo);
      gl.bufferData(gl.ARRAY_BUFFER, model.texcoords, gl.STATIC_DRAW);

      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, model.indices, gl.STATIC_DRAW);

      return {
         vertexBuffer: vbo,
         normalBuffer: nbo,
         texcoordBuffer: tbo,
         indexBuffer: ibo,
         indexCount: model.indices.length,
      };
   });

   // ===== OTIMIZAÇÃO 2: FUNÇÃO DE DESENHO OTIMIZADA =====
   function drawObj(obj) {
      const modelIndex = obj.modelIndex % models.length;
      const buffers = modelBuffers[modelIndex];

      // Bind dos buffers (muito mais rápido que bufferData)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertexBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normalBuffer);
      gl.enableVertexAttribArray(normalLocation);
      gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texcoordBuffer);
      gl.enableVertexAttribArray(texcoordLocation);
      gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indexBuffer);

      // Cores e texturas
      let objColor = obj.color || [1.0, 1.0, 1.0];
      gl.uniform3fv(colorUniformLocation, new Float32Array(objColor));

      let shouldUseTexture =
         obj.useTexture !== undefined ? obj.useTexture : useTexture;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(textureUniformLocation, 0);
      gl.uniform1i(useTextureUniformLocation, shouldUseTexture ? 1 : 0);

      // Matrizes
      let modelViewMatrix = m4.identity();
      modelViewMatrix = m4.scale(
         modelViewMatrix,
         obj.scale,
         obj.scale,
         obj.scale
      );

      let rotationAngle = 0;
      if (obj.rotationY !== undefined) {
         rotationAngle = obj.rotationY;
      } else {
         rotationAngle = obj.direction === 1 ? 0 : 180;
      }
      modelViewMatrix = m4.yRotate(modelViewMatrix, degToRad(rotationAngle));

      if (obj.rotationX) {
         modelViewMatrix = m4.xRotate(modelViewMatrix, degToRad(obj.rotationX));
      }

      modelViewMatrix = m4.translate(modelViewMatrix, obj.x, obj.y, obj.z);

      let inverseTransposeModelViewMatrix = m4.transpose(
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

      gl.drawElements(gl.TRIANGLES, buffers.indexCount, gl.UNSIGNED_SHORT, 0);
   }

   let isPaused = false;
   let isGameOver = false;

   const gameOverModal = document.getElementById("gameOverModal");
   const finalScoreElement = document.getElementById("finalScore");
   const restartBtn = document.getElementById("restartBtn");

   const pauseBtn = document.getElementById("pauseBtn");
   pauseBtn.addEventListener("click", () => {
      isPaused = !isPaused;
      pauseBtn.textContent = isPaused ? "RESUME" : "PAUSE";

      // Opcional: tirar o foco do botão para que o 'Espaço' não ative o botão novamente
      pauseBtn.blur();
   });

   restartBtn.addEventListener("click", () => {
      restartGame();
   });

   // PONTUAÇÃO
   const initialX = -5; // Mesma posição inicial do player definida no objeto player
   let maxDistanceX = initialX; // Guarda a posição mais longe que a rena já chegou

   const scoreElement = document.getElementById("score");

   // --- VARIÁVEIS DO AUTO-SCROLL ---
   // A câmera começa na mesma posição Y inicial do jogador (-12 atualmente)
   let cameraX = -12.0;

   // Velocidade da câmera (unidades por segundo)
   // Ajuste este valor: 1.0 é lento, 3.0 é rápido/difícil
   const scrollSpeed = 0.2;

   let frameCount = 0;

   // Função para atualizar os faróis dos carros
   function updateHeadlights() {
      // 1. Resetar todas as luzes para "desligadas" (cor preta)
      for (let i = 0; i < MAX_SPOTLIGHTS; i++) {
         gl.uniform3fv(spotLightColorLocs[i], new Float32Array([0, 0, 0]));
      }

      // 2. Encontrar os carros mais próximos do jogador
      // Filtra carros que estão na tela (perto da câmera) e ordena por distância
      const visibleCars = cars
         .filter((car) => car.x > cameraX - 10 && car.x < cameraX + 30)
         .sort((a, b) => {
            const distA = Math.sqrt(
               Math.pow(a.x - player.x, 2) + Math.pow(a.z - player.z, 2)
            );
            const distB = Math.sqrt(
               Math.pow(b.x - player.x, 2) + Math.pow(b.z - player.z, 2)
            );
            return distA - distB;
         });

      // 3. Pegar os 2 primeiros carros e ligar os faróis (2 faróis por carro = 4 total)
      let lightIndex = 0;
      for (let i = 0; i < Math.min(visibleCars.length, 2); i++) {
         const car = visibleCars[i];
         const dirZ = car.direction; // 1 (direita) ou -1 (esquerda)

         // Farol 1 (Esquerdo)
         // Ajuste o offset conforme o tamanho do seu modelo de carro
         const offsetZ1 = 0.3;
         const offsetX = 0.8; // Farol está na frente do carro

         // Posição: Centro do carro + Offset
         // Como o carro anda em Z, a "frente" depende da direção
         const lx1 = car.x;
         const ly1 = car.y + 0.5; // Altura do farol
         const lz1 = car.z + offsetZ1 * dirZ; // Na frente (Z)

         // Farol 2 (Direito)
         const lz2 = car.z - offsetZ1 * dirZ;

         // Direção do facho de luz (Aponta para onde o carro vai: Eixo Z)
         const lightDir = [0.0, -0.2, dirZ]; // Levemente para baixo e para frente Z

         // Cor do Farol (Amarelo claro)
         const lightColor = [1.0, 0.9, 0.6];

         if (lightIndex < MAX_SPOTLIGHTS) {
            gl.uniform3fv(
               spotLightPosLocs[lightIndex],
               new Float32Array([lx1 + 0.3, ly1, car.z + dirZ * 0.5])
            ); // Ajuste fino da posição
            gl.uniform3fv(
               spotLightDirLocs[lightIndex],
               new Float32Array(lightDir)
            );
            gl.uniform3fv(
               spotLightColorLocs[lightIndex],
               new Float32Array(lightColor)
            );
            lightIndex++;
         }
         if (lightIndex < MAX_SPOTLIGHTS) {
            gl.uniform3fv(
               spotLightPosLocs[lightIndex],
               new Float32Array([lx1 - 0.3, ly1, car.z + dirZ * 0.5])
            );
            gl.uniform3fv(
               spotLightDirLocs[lightIndex],
               new Float32Array(lightDir)
            );
            gl.uniform3fv(
               spotLightColorLocs[lightIndex],
               new Float32Array(lightColor)
            );
            lightIndex++;
         }
      }
   }

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
      if (player.x > maxDistanceX) {
         maxDistanceX = player.x;

         // 2. Calcula os pontos: Distância Percorrida / Tamanho do Passo
         // Math.floor remove decimais minúsculos de erro de flutuação
         const currentScore = Math.floor((maxDistanceX - initialX) / step);

         // 3. Atualiza o HTML
         scoreElement.textContent = currentScore;
      }

      //proporções do mundo
      const worldWidth = 6.0;
      const aspect = gl.canvas.width / gl.canvas.height;
      const worldHeight = worldWidth / aspect;

      cameraX += scrollSpeed * dt;

      if (player.x < cameraX + 3.8) {
         // valor escolhido a dedo, talvez seja necessário trocar
         gameOver();
      }

      //Verifica o limite de 1/3 da tela
      // O centro da tela (TargetY) é "cameraY + lookAhead".
      // A base da tela é "CenterY - worldHeight/2".
      // A linha de 1/3 é "Base + worldHeight/3".
      // Simplificando a matemática: Se o jogador passar dessa linha, ajustamos o cameraY.

      const lookAhead = 10.0;

      // Essa fórmula garante que o jogador fique na linha de 1/3 visualmente
      // CenterY = PlayerY + H/6 (H/6 é a diferença entre o meio e o 1/3 inferior)f
      // Como CenterY = cameraY + lookAhead, isolamos o cameraY:
      const minCameraYForPlayer = player.x + worldHeight / 6.0 - lookAhead;

      // Se o scroll automático estiver atrasado em relação ao jogador, puxa a câmera
      if (cameraX < minCameraYForPlayer) {
         cameraX = minCameraYForPlayer;
      }

      let targetX = cameraX + lookAhead;
      let targetY = 0.0;
      let targetZ = player.z;

      let Pref = [targetX, targetY, targetZ];

      // 2. Onde a câmera está? (Eye/Position)
      // Mantemos o deslocamento original (offset) de [0, 30, 30] em relação ao alvo
      // Isso preserva o ângulo de 45 graus e a distância
      let P0 = [
         targetX - 10, // Segue lateralmente
         targetY + 15.0, // Mantém altura/distância Y
         targetZ + 1.0,
      ];

      if (projectionMode === "perspective") {
         // Câmera mais alta e mais afastada para trás, mas com zoom (definido no updateProjection)
         // Isso cria um efeito "Cinemático" estilo jogo de console
         P0 = [
            targetX - 25.0, // Bem mais para trás
            targetY + 20.0, // Bem alto
            targetZ + 0.0,
         ];
      } else {
         // --- MODO ORTOGRÁFICO (Mantém sua lógica de Câmeras C) ---
         switch (cameraMode) {
            case 0: // PADRÃO (Isométrica)
               P0 = [targetX - 10.0, targetY + 15.0, targetZ + 1.0];
               break;
            case 1: // TOP-DOWN
               P0 = [targetX - 0.1, targetY + 30.0, targetZ];
               // Ajuste o vetor UP para não dar problema no top-down estrito
               if (cameraMode === 1) V = [1.0, 0.0, 0.0];
               break;
         }
      }

      // 3. Recalcula a matriz
      // Nota: 'V' (vetor up [0,1,0]) deve estar acessível no escopo da main
      let viewingMatrix = m4.setViewingMatrix(P0, Pref, V);

      // 4. Envia para a GPU
      gl.uniformMatrix4fv(viewingMatrixUniformLocation, false, viewingMatrix);

      // Atualiza a posição da câmera para o cálculo de brilho especular (importante!)
      gl.uniform3fv(viewPositionUniformLocation, new Float32Array(P0));

      // (Opcional) Faz a luz acompanhar o jogador para o mundo não ficar escuro lá na frente
      let lightPos = [targetX + 10.0, 50.0, 20.0];
      gl.uniform3fv(lightPositionUniformLocation, new Float32Array(lightPos));

      // ----------------------------------
      updateHeadlights();

      // Atualiza posição de todos os carros
      cars.forEach((car) => {
         const newZ = car.z + car.speed * car.direction * dt;

         // Verifica se a nova posição colidiria com outro carro
         const wouldCollide = cars.some((otherCar) => {
            return (
               otherCar !== car &&
               otherCar.x === car.x &&
               Math.abs(otherCar.z - newZ) < 2.0
            ); // Raio de colisão
         });

         if (!wouldCollide) {
            car.z = newZ;
         }

         // Loop infinito: verifica movimento real (speed * direction)
         const velocidadeReal = car.speed * car.direction;
         if (velocidadeReal > 0 && car.z > car.maxZ) {
            car.z = car.minZ;
         } else if (velocidadeReal < 0 && car.z < car.minZ) {
            car.z = car.maxZ;
         }
      });

      if (checkCollisionWithCars(player.x, player.z)) {
         gameOver();
      }

      updateTerrain(cameraX);

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      if (rotateX) theta_x += 1;
      if (rotateY) theta_y += 1;
      if (rotateZ) theta_z += 1;

      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

      drawTerrain();

      // Desenha as árvores
      trees.forEach((tree) => {
         drawObj(tree);
      });

      // Desenha todos os carros
      cars.forEach((car) => {
         drawObj(car);
      });

      drawObj(player);

      frameCount++;

      requestAnimationFrame(drawScene);
   }

   // Inicializa o terreno ao redor da posição inicial do player (-12)
   initTerrain(-12);

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
