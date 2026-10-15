import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Fórmula pura de distribución de categorías en el POS
function getCategoryGridPosition(index) {
  const PAGE_SIZE = 8;
  const ROW_SIZE = 4;
  const page = Math.floor(index / PAGE_SIZE);
  const posInPage = index % PAGE_SIZE;
  const row = posInPage < ROW_SIZE ? 1 : 2;
  const col = page * ROW_SIZE + (posInPage % ROW_SIZE) + 1;
  return { row, col };
}

test('distribución de categorías: 8 categorías van exactamente 4 arriba y 4 abajo', () => {
  // Las primeras 4 categorías van en Fila 1, Columnas 1 a 4
  for (let i = 0; i < 4; i++) {
    const pos = getCategoryGridPosition(i);
    assert.equal(pos.row, 1, `Categoría en índice ${i} debe ir en fila 1`);
    assert.equal(pos.col, i + 1, `Categoría en índice ${i} debe ir en columna ${i + 1}`);
  }

  // Las siguientes 4 categorías van en Fila 2, Columnas 1 a 4
  for (let i = 4; i < 8; i++) {
    const pos = getCategoryGridPosition(i);
    assert.equal(pos.row, 2, `Categoría en índice ${i} debe ir en fila 2`);
    assert.equal(pos.col, i - 4 + 1, `Categoría en índice ${i} debe ir en columna ${i - 4 + 1}`);
  }
});

test('distribución de categorías: la 9ª categoría va en fila 1, columna 5 para navegación por flechas', () => {
  const cat9 = getCategoryGridPosition(8);
  assert.equal(cat9.row, 1, 'La 9ª categoría (índice 8) debe ir en fila 1');
  assert.equal(cat9.col, 5, 'La 9ª categoría (índice 8) debe ir en columna 5');

  const cat10 = getCategoryGridPosition(9);
  assert.equal(cat10.row, 1);
  assert.equal(cat10.col, 6);

  // La 13ª categoría (índice 12) es la primera abajo en la página 2
  const cat13 = getCategoryGridPosition(12);
  assert.equal(cat13.row, 2);
  assert.equal(cat13.col, 5);
});

test('código de vender.js implementa la estructura de barra con flechas y grid de 2 filas', () => {
  const code = fs.readFileSync(path.join(ROOT, 'js/views/vender.js'), 'utf8');
  assert.ok(code.includes('pos-cats-bar'), 'Debe incluir el contenedor pos-cats-bar');
  assert.ok(code.includes('cat-nav-prev'), 'Debe incluir el botón previo');
  assert.ok(code.includes('cat-nav-next'), 'Debe incluir el botón siguiente');
  assert.ok(code.includes('pos-cats-grid'), 'Debe incluir el grid de categorías');
  assert.ok(code.includes('PAGE_SIZE = 8'), 'Debe definir el tamaño de página de 8');
  assert.ok(code.includes('ROW_SIZE = 4'), 'Debe definir 4 columnas por fila');
});

test('estilos de styles.css definen las clases necesarias para la barra responsiva', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');
  assert.ok(css.includes('.pos-cats-bar'), 'CSS debe definir .pos-cats-bar');
  assert.ok(css.includes('.cat-nav-btn'), 'CSS debe definir .cat-nav-btn');
  assert.ok(css.includes('.pos-cats-scroll'), 'CSS debe definir .pos-cats-scroll');
  assert.ok(css.includes('.pos-cats-grid'), 'CSS debe definir .pos-cats-grid');
  assert.ok(css.includes('grid-template-rows: repeat(2, 44px)'), 'CSS debe definir 2 filas en el grid');
});

test('distribución con volumen mayor a 20: 25 categorías se distribuyen sin solapamientos en 13 columnas', () => {
  const positions = new Set();
  for (let i = 0; i < 25; i++) {
    const pos = getCategoryGridPosition(i);
    assert.ok(pos.row === 1 || pos.row === 2, `Fila debe ser 1 o 2`);
    assert.ok(pos.col >= 1 && pos.col <= 13, `Columna debe estar entre 1 y 13`);
    const key = `${pos.row},${pos.col}`;
    assert.ok(!positions.has(key), `La celda (${key}) no debe estar duplicada`);
    positions.add(key);
  }

  // La 25ª categoría (índice 24) debe ubicarse en Fila 1, Columna 13
  const cat25 = getCategoryGridPosition(24);
  assert.equal(cat25.row, 1);
  assert.equal(cat25.col, 13);
});
