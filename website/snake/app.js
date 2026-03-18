import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.183.2/build/three.module.js';

const GRID_SIZE = 10;
const BASE_STEP_MS = 250;
const MIN_STEP_MS = 110;
const SPEED_UP_EVERY = 4;
const CAMERA_RADIUS = 16.6;
const CAMERA_HEIGHT = 15.4;
const BOARD_Y = -0.85;

const wrap = document.getElementById('canvasWrap');
const scoreValue = document.getElementById('scoreValue');
const bestValue = document.getElementById('bestValue');
const speedValue = document.getElementById('speedValue');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayText = document.getElementById('overlayText');
const playBtn = document.getElementById('playBtn');
const restartBtn = document.getElementById('restartBtn');
const pauseBtn = document.getElementById('pauseBtn');

const controls = {
  up: document.getElementById('upBtn'),
  down: document.getElementById('downBtn'),
  left: document.getElementById('leftBtn'),
  right: document.getElementById('rightBtn')
};

const directions = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 }
};

let renderer;
let scene;
let camera;
let animationId = 0;
let lastFrame = 0;
let accumulator = 0;
let stepMs = BASE_STEP_MS;
let cameraAngle = -0.65;
let cameraTargetAngle = -0.65;
let gameRunning = false;
let gameStarted = false;
let paused = false;
let score = 0;
let bestScore = 0;
let snake = [];
let direction = directions.right;
let queuedDirection = directions.right;
let food = { x: 0, z: 0 };
let boardGroup;
let snakeGroup;
let foodMesh;
let foodGlow;
let snakeMeshes = [];
let boardEdges;
let bestPromise = Promise.resolve();
let resizeObserver;
let boardFlash = 0;
let pulse = 0;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function triggerPulse(element) {
  if (!element) return;
  element.classList.remove('pulse-pop');
  void element.offsetWidth;
  element.classList.add('pulse-pop');
}

function triggerShake() {
  wrap.classList.remove('shake');
  void wrap.offsetWidth;
  wrap.classList.add('shake');
}

function setButtonGlow(button, active) {
  if (!button) return;
  button.classList.remove('pressed');
  void button.offsetWidth;
  if (active) button.classList.add('pressed');
}

function resetCamera() {
  cameraAngle = 0;
  cameraTargetAngle = 0;
}

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function updatePauseButton() {
  pauseBtn.textContent = gameRunning ? 'Pause' : 'Resume';
}

function showOverlay(title, text, buttonText = 'Play') {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  playBtn.textContent = buttonText;
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

async function loadBestScore() {
  try {
    if (window.miniapp?.storage) {
      bestScore = Number(await window.miniapp.storage.get('snake3dBest')) || 0;
      bestValue.textContent = String(bestScore);
    }
  } catch (error) {
    console.warn('Unable to load best score', error);
  }
}

async function saveBestScore() {
  try {
    if (window.miniapp?.storage) {
      await window.miniapp.storage.set('snake3dBest', bestScore);
    }
  } catch (error) {
    console.warn('Unable to save best score', error);
  }
}

function updateScoreboard() {
  scoreValue.textContent = String(score);
  bestValue.textContent = String(bestScore);
  speedValue.textContent = `${1 + Math.floor(score / SPEED_UP_EVERY)}x`;
}

function getStepMs() {
  return Math.max(MIN_STEP_MS, BASE_STEP_MS - Math.floor(score / SPEED_UP_EVERY) * 18);
}

function createRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  wrap.appendChild(renderer.domElement);
}

function buildScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x07111f, 22, 42);

  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
  camera.position.set(0, CAMERA_HEIGHT, CAMERA_RADIUS);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0x93b2ff, 1.25);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.65);
  keyLight.position.set(-5, 12, 8);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  scene.add(keyLight);

  const rim = new THREE.DirectionalLight(0x58e38a, 0.7);
  rim.position.set(6, 7, -8);
  scene.add(rim);

  const boardLight = new THREE.PointLight(0x58e38a, 2.3, 18, 2);
  boardLight.position.set(0, 3.5, 0);
  scene.add(boardLight);

  scene.add(createStarField());
  scene.add(createBoard());
  scene.add(createSnakeGroup());
  scene.add(createFood());
}

function createStarField() {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(0.03, 8, 8);
  const material = new THREE.MeshBasicMaterial({ color: 0xbfd9ff });
  for (let i = 0; i < 60; i += 1) {
    const star = new THREE.Mesh(geometry, material);
    star.position.set((Math.random() - 0.5) * 60, 8 + Math.random() * 18, (Math.random() - 0.5) * 60);
    star.scale.setScalar(0.6 + Math.random() * 1.8);
    group.add(star);
  }
  return group;
}

function createBoard() {
  boardGroup = new THREE.Group();

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(GRID_SIZE + 1.2, 0.5, GRID_SIZE + 1.2),
    new THREE.MeshStandardMaterial({ color: 0x10243d, roughness: 0.95, metalness: 0.05 })
  );
  floor.position.y = BOARD_Y;
  floor.receiveShadow = true;
  boardGroup.add(floor);

  const gridMaterial = new THREE.MeshStandardMaterial({ color: 0x17395f, roughness: 0.8, metalness: 0.1, emissive: 0x06101c, emissiveIntensity: 0.4 });
  for (let x = 0; x < GRID_SIZE; x += 1) {
    for (let z = 0; z < GRID_SIZE; z += 1) {
      const tile = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 0.95), gridMaterial);
      tile.position.set(x - GRID_SIZE / 2 + 0.5, BOARD_Y + 0.28, z - GRID_SIZE / 2 + 0.5);
      tile.receiveShadow = true;
      boardGroup.add(tile);
    }
  }

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x0d1a2c, roughness: 0.85, metalness: 0.04, emissive: 0x0a1423, emissiveIntensity: 0.45 });
  const wallGeometry = new THREE.BoxGeometry(GRID_SIZE + 1.6, 1.1, 0.35);
  const sideGeometry = new THREE.BoxGeometry(0.35, 1.1, GRID_SIZE + 1.6);
  const northWall = new THREE.Mesh(wallGeometry, wallMaterial);
  northWall.position.set(0, BOARD_Y + 0.53, -GRID_SIZE / 2 - 0.85);
  const southWall = northWall.clone();
  southWall.position.z = GRID_SIZE / 2 + 0.85;
  const westWall = new THREE.Mesh(sideGeometry, wallMaterial);
  westWall.position.set(-GRID_SIZE / 2 - 0.85, BOARD_Y + 0.53, 0);
  const eastWall = westWall.clone();
  eastWall.position.x = GRID_SIZE / 2 + 0.85;

  boardGroup.add(northWall, southWall, westWall, eastWall);

  const edgeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(GRID_SIZE + 1.2, 0.5, GRID_SIZE + 1.2));
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x58e38a, transparent: true, opacity: 0.35 });
  boardEdges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  boardEdges.position.y = BOARD_Y;
  boardGroup.add(boardEdges);

  return boardGroup;
}

function createSnakeGroup() {
  snakeGroup = new THREE.Group();
  return snakeGroup;
}

function createSnakeMaterial(index) {
  const hue = 0.31 + index * 0.004;
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(hue, 0.76, 0.54 + Math.min(index * 0.006, 0.12)),
    roughness: 0.45,
    metalness: 0.15,
    emissive: 0x0b2f14,
    emissiveIntensity: 0.4
  });
}

function cellToWorld(cell) {
  return {
    x: cell.x - GRID_SIZE / 2 + 0.5,
    y: BOARD_Y + 0.46 + Math.min(cell.index * 0.03, 0.18),
    z: cell.z - GRID_SIZE / 2 + 0.5
  };
}

function rebuildSnakeMeshes() {
  while (snakeGroup.children.length) {
    snakeGroup.remove(snakeGroup.children[0]);
  }
  snakeMeshes = [];

  snake.forEach((segment, index) => {
    const geometry = index === 0 ? new THREE.BoxGeometry(0.88, 0.88, 0.88) : new THREE.BoxGeometry(0.84, 0.82, 0.84);
    const material = createSnakeMaterial(index);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    snakeMeshes.push(mesh);
    snakeGroup.add(mesh);
  });
}

function createFood() {
  foodMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0xff6177, emissive: 0xff3550, emissiveIntensity: 1.4, roughness: 0.25, metalness: 0.2 })
  );
  foodMesh.castShadow = true;
  foodMesh.receiveShadow = true;
  foodGlow = new THREE.PointLight(0xff4f6b, 2.1, 8, 2);
  foodMesh.add(foodGlow);
  return foodMesh;
}

function placeFood() {
  const occupied = new Set(snake.map(cell => `${cell.x},${cell.z}`));
  do {
    food = {
      x: Math.floor(Math.random() * GRID_SIZE),
      z: Math.floor(Math.random() * GRID_SIZE)
    };
  } while (occupied.has(`${food.x},${food.z}`));

  foodMesh.position.set(food.x - GRID_SIZE / 2 + 0.5, BOARD_Y + 0.62, food.z - GRID_SIZE / 2 + 0.5);
}

function resetGame() {
  const mid = Math.floor(GRID_SIZE / 2);
  snake = [
    { x: mid, z: mid },
    { x: mid - 1, z: mid },
    { x: mid - 2, z: mid }
  ];
  direction = directions.right;
  queuedDirection = direction;
  resetCamera();
  score = 0;
  paused = false;
  boardFlash = 0;
  pulse = 0;
  stepMs = BASE_STEP_MS;
  updatePauseButton();
  rebuildSnakeMeshes();
  placeFood();
  updateScoreboard();
  drawBoardTint();
}

function startGame(forceReset = false) {
  if (!gameStarted || forceReset) {
    resetGame();
    gameStarted = true;
  }
  gameRunning = true;
  paused = false;
  accumulator = 0;
  hideOverlay();
  updatePauseButton();
  vibrate(14);
  stepMs = getStepMs();
}

function pauseGame() {
  if (!gameStarted || !gameRunning) return;
  gameRunning = false;
  paused = true;
  updatePauseButton();
  vibrate(10);
  showOverlay('Paused', 'Tap resume when you are ready to keep going.', 'Resume');
}

function endGame() {
  gameRunning = false;
  paused = false;
  if (score > bestScore) {
    bestScore = score;
    saveBestScore();
  }
  triggerShake();
  triggerPulse(scoreValue);
  triggerPulse(bestValue);
  vibrate([35, 40, 50]);
  updateScoreboard();
  updatePauseButton();
  showOverlay('Game over', `Final score: ${score}. Tap to try again.`, 'Play Again');
}

function setDirection(key) {
  const next = directions[key];
  if (!next || !gameRunning) return;
  const isReverse = snake.length > 1 && next.x === -direction.x && next.z === -direction.z;
  if (isReverse) return;
  queuedDirection = next;
  setButtonGlow(controls[key], true);
  vibrate(5);
}

function stepGame() {
  direction = queuedDirection;
  const head = snake[0];
  const nextHead = { x: head.x + direction.x, z: head.z + direction.z };
  const hitsWall = nextHead.x < 0 || nextHead.z < 0 || nextHead.x >= GRID_SIZE || nextHead.z >= GRID_SIZE;
  const hitsSelf = snake.some(segment => segment.x === nextHead.x && segment.z === nextHead.z);

  if (hitsWall || hitsSelf) {
    draw();
    endGame();
    return;
  }

  snake.unshift(nextHead);

  if (nextHead.x === food.x && nextHead.z === food.z) {
    score += 1;
    pulse = 1;
    boardFlash = 1;
    const previousBest = bestScore;
    if (score > bestScore) {
      bestScore = score;
      saveBestScore();
    }
    rebuildSnakeMeshes();
    placeFood();
    updateScoreboard();
    triggerPulse(scoreValue);
    if (score > previousBest) triggerPulse(bestValue);
    vibrate(18);
    stepMs = getStepMs();
  } else {
    snake.pop();
    rebuildSnakeMeshes();
  }
}

function updateSnakeMeshes(time) {
  snakeMeshes.forEach((mesh, index) => {
    const target = snake[index];
    const world = cellToWorld({ ...target, index });
    mesh.position.set(world.x, world.y + Math.sin(time * 0.003 + index * 0.45) * 0.05, world.z);
    mesh.rotation.y = Math.sin(time * 0.0014 + index * 0.2) * 0.08;
    if (index === 0) {
      mesh.scale.setScalar(1 + Math.sin(time * 0.004) * 0.02);
    } else {
      mesh.scale.setScalar(1);
    }
  });
}

function drawBoardTint() {
  if (!boardEdges?.material) return;
  boardEdges.material.opacity = 0.34 + boardFlash * 0.18;
}

function updateCamera(time) {
  cameraAngle += (cameraTargetAngle - cameraAngle) * 0.08;
  const wobble = Math.sin(time * 0.0005) * 0.18;
  camera.position.x = Math.sin(cameraAngle) * CAMERA_RADIUS;
  camera.position.z = Math.cos(cameraAngle) * CAMERA_RADIUS;
  camera.position.y = CAMERA_HEIGHT + wobble;
  camera.lookAt(0, 0.1, 0);
}

function draw(time = 0) {
  if (!renderer) return;
  boardFlash = Math.max(0, boardFlash - 0.02);
  pulse = Math.max(0, pulse - 0.015);
  drawBoardTint();
  updateCamera(time);
  updateSnakeMeshes(time);
  foodMesh.rotation.y += 0.03;
  foodMesh.position.y = BOARD_Y + 0.68 + Math.sin(time * 0.004) * 0.12;
  foodGlow.intensity = 1.7 + Math.sin(time * 0.006) * 0.25;
  renderer.render(scene, camera);
}

function resize() {
  const rect = wrap.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  draw();
}

function loop(time) {
  animationId = requestAnimationFrame(loop);
  const delta = time - lastFrame;
  lastFrame = time;
  if (!gameStarted) {
    draw(time);
    return;
  }
  if (gameRunning) {
    accumulator += delta;
    while (accumulator >= stepMs) {
      accumulator -= stepMs;
      stepGame();
      stepMs = getStepMs();
      if (!gameRunning) break;
    }
  }
  draw(time);
}

function bindControls() {
  const map = [
    ['up', 'up'],
    ['down', 'down'],
    ['left', 'left'],
    ['right', 'right']
  ];

  map.forEach(([key, dir]) => {
    controls[key].addEventListener('click', () => setDirection(dir));
    controls[key].addEventListener('pointerdown', () => setButtonGlow(controls[key], true));
  });

  playBtn.addEventListener('click', () => {
    if (!gameStarted) {
      startGame();
      return;
    }
    if (paused) {
      startGame();
      return;
    }
    if (!gameRunning) {
      startGame(true);
      return;
    }
    pauseGame();
  });

  restartBtn.addEventListener('click', () => {
    startGame(true);
  });

  pauseBtn.addEventListener('click', () => {
    if (!gameStarted || (!gameRunning && !paused)) return;
    if (gameRunning) pauseGame();
    else {
      gameRunning = true;
      paused = false;
      hideOverlay();
      updatePauseButton();
    }
  });

  window.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    if (key === 'arrowup' || key === 'w') setDirection('up');
    if (key === 'arrowdown' || key === 's') setDirection('down');
    if (key === 'arrowleft' || key === 'a') setDirection('left');
    if (key === 'arrowright' || key === 'd') setDirection('right');
    if (key === 'p') {
      if (gameRunning) pauseGame();
      else if (gameStarted) { gameRunning = true; paused = false; hideOverlay(); updatePauseButton(); }
    }
  });

  wrap.addEventListener('pointerdown', onPointerStart, { passive: true });
  wrap.addEventListener('pointermove', onPointerMove, { passive: true });
  wrap.addEventListener('pointerup', onPointerEnd, { passive: true });
  wrap.addEventListener('pointercancel', onPointerEnd, { passive: true });
}

let gestureStart = null;
function onPointerStart(event) {
  gestureStart = { x: event.clientX, y: event.clientY, time: performance.now() };
}
function onPointerMove(event) {
  if (!gestureStart) return;
  const dx = event.clientX - gestureStart.x;
  const dy = event.clientY - gestureStart.y;
  if (Math.hypot(dx, dy) < 24) return;
  if (Math.abs(dx) > Math.abs(dy)) {
    setDirection(dx > 0 ? 'right' : 'left');
  } else {
    setDirection(dy > 0 ? 'down' : 'up');
  }
  gestureStart = null;
}
function onPointerEnd() {
  gestureStart = null;
}

function pulseButtons() {
  Object.values(controls).filter(Boolean).forEach(button => {
    button.addEventListener('animationend', () => button.classList.remove('pressed'), { once: false });
    button.addEventListener('pointerup', () => button.classList.remove('pressed'));
    button.addEventListener('pointercancel', () => button.classList.remove('pressed'));
  });
}

async function main() {
  createRenderer();
  buildScene();
  bindControls();
  pulseButtons();
  await loadBestScore();
  updateScoreboard();
  updatePauseButton();
  resize();
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(wrap);
  window.addEventListener('resize', resize);
  showOverlay('Tap Play', 'Steer the snake in 3D, eat glowing fruit, and avoid the walls and yourself.', 'Play');
  animationId = requestAnimationFrame(loop);
}

main();
