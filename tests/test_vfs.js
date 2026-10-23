// Testes do disco virtual. Executa o CÓDIGO ORIGINAL das extensões do jogo contra o shim.
// Uso: node tests/test_vfs.js
'use strict';
const assert = require('assert'), nfs = require('fs'), npath = require('path'), vm = require('vm');
const WWW = npath.join(__dirname, '..', 'www'), SHIM = npath.join(WWW, 'ms-android', 'vfs-shim.js');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FALHA ' + name + '\n       ' + (e && e.stack || e).split('\n').slice(0, 3).join('\n       ')); } };

// ---- IndexedDB falso (suficiente para o que o shim usa) ----
function fakeIDB(store) {
  const mkReq = (fn) => { const r = {}; setTimeout(() => { try { r.result = fn(); r.onsuccess && r.onsuccess(); } catch (e) { r.error = e; r.onerror && r.onerror(); } }, 0); return r; };
  const objStore = (name) => { const m = store[name] || (store[name] = new Map()); return {
    getAllKeys: () => mkReq(() => [...m.keys()]), getAll: () => mkReq(() => [...m.values()].map((v) => structuredClone(v))),
    get: (k) => mkReq(() => (m.has(k) ? structuredClone(m.get(k)) : undefined)),
    clear: () => { m.clear(); }, put: (v, k) => { m.set(k, structuredClone(v)); } }; };
  return { open() { const r = {}; setTimeout(() => { const db = { createObjectStore: (n) => objStore(n), transaction: () => { const tx = { objectStore: objStore }; setTimeout(() => tx.oncomplete && tx.oncomplete(), 5); return tx; } };
    r.result = db; if (!store.__init) { store.__init = 1; r.onupgradeneeded && r.onupgradeneeded(); } r.onsuccess && r.onsuccess(); }, 0); return r; } };
}

function loadShim(idbStore) {
  delete globalThis.MSVFS; delete require.cache[require.resolve(SHIM)];
  globalThis.__MSVFS_NO_AUTOINIT = true; globalThis.indexedDB = fakeIDB(idbStore);
  const M = require(SHIM);
  M.transport.syncRead = (u) => { try { return new Uint8Array(nfs.readFileSync(npath.join(WWW, u))); } catch (_) { return null; } };
  M.transport.asyncRead = async (u) => M.transport.syncRead(u);
  M.transport.manifest = async () => JSON.parse(nfs.readFileSync(npath.join(WWW, 'ms-android', 'manifest.json'), 'utf8'));
  return M;
}
function loadExt(file, M) {
  const made = [];
  const Scratch = { BlockType: { COMMAND: 'c', REPORTER: 'r', BOOLEAN: 'b' }, ArgumentType: { STRING: 's', NUMBER: 'n' }, translate: (s) => s, extensions: { register: (x) => made.push(x) } };
  const ctx = vm.createContext({ Scratch, require: M.require, process: M.process, Buffer: M.Buffer, console });
  vm.runInContext(nfs.readFileSync(npath.join(__dirname, 'fixtures', file), 'utf8'), ctx);
  assert.strictEqual(made.length, 1, 'extensão não se registrou'); return made[0];
}

(async () => {
  const idb = {};
  let M = loadShim(idb); await M.init();
  const { path, fs } = M;

  console.log('path (estilo Windows)');
  await t('resolve com barra invertida e unidade', () => { assert.strictEqual(path.resolve('C:\\Users\\x\\..\\y'), '/Users/y'); assert.strictEqual(path.resolve('/app', '.\\Assets'), '/app/Assets'); });
  await t('join/dirname/extname', () => { assert.strictEqual(path.join('/app/resources', 'app.asar', 'part1.zip'), '/app/resources/app.asar/part1.zip'); assert.strictEqual(path.dirname('/a/b/c.png'), '/a/b'); assert.strictEqual(path.extname('x/y.OGG'), '.OGG'); assert.strictEqual(path.join('\\data\\'), '/data'); });

  console.log('camada somente-leitura (arquivos do jogo)');
  await t('lê checks.js idêntico ao original (case-insensitive: /App/DATA/Scripts)', () => { const a = fs.readFileSync('/App/DATA/Scripts/CHECKS.JS', 'utf8'), b = nfs.readFileSync(npath.join(WWW, 'data/scripts/checks.js'), 'utf8'); assert.strictEqual(a, b); });
  await t('readFile assíncrono do part1.zip pelo caminho do "app.asar"', async () => { const b = await fs.promises.readFile(path.join(M.process.resourcesPath, 'app.asar', 'part1.zip')); assert.strictEqual(b.length, nfs.statSync(npath.join(WWW, 'part1.zip')).size); assert.strictEqual(b.toString('latin1', 0, 2), 'PK'); });
  await t('readdir com tipos', () => { const e = fs.readdirSync('/app/data', { withFileTypes: true }); assert.ok(e.some((x) => x.isDirectory() && x.name === 'mus')); assert.ok(e.every((x) => x.isFile() !== x.isDirectory())); });
  await t('base64 de PNG igual ao do Node (readFileDataURI)', () => { const rel = JSON.parse(nfs.readFileSync(npath.join(WWW, 'ms-android/manifest.json'))).files.find((f) => f[0].endsWith('.png') && f[0].startsWith('/app/data') && f[2] < 20000); const b = fs.readFileSync(rel[0]); assert.strictEqual(b.toString('base64'), nfs.readFileSync(npath.join(WWW, rel[1])).toString('base64')); });
  await t('arquivo inexistente -> ENOENT; escrever em pasta -> EISDIR', () => { assert.throws(() => fs.readFileSync('/app/data/nao_existe.txt'), (e) => e.code === 'ENOENT'); assert.throws(() => fs.writeFileSync('/app/data', 'x'), (e) => e.code === 'EISDIR'); });

  console.log('extensões ORIGINAIS do jogo rodando sobre o shim');
  const sys = loadExt('ext_nodesyschunk2.original.js', M), sto = loadExt('ext_nodesyschunk1.original.js', M);
  await t('getEnv/PORTABLE_EXECUTABLE_DIR e USERPROFILE', () => { assert.strictEqual(sys.getEnv({ NAME: 'PORTABLE_EXECUTABLE_DIR' }), '/app'); assert.ok(sys.getEnv({ NAME: 'USERPROFILE' })); assert.strictEqual(sys.getEnv({ NAME: 'NAO_EXISTE' }), ''); });
  await t('sequência real do jogo: Home -> \\data\\ -> .\\Scripts -> lê checks.js', () => {
    const home = sys.getEnv({ NAME: 'PORTABLE_EXECUTABLE_DIR' }); sys.changeDir({ FOLDER: home });
    assert.strictEqual(sto.folderExists({ FOLDERNAME: 'data', DIRECTORY: '' }), true);
    sys.changeDir({ FOLDER: home + '\\data\\' }); assert.strictEqual(sys.getCwd(), '/app/data');
    sys.changeDir({ FOLDER: '.\\Scripts' }); const script = sto.readFile({ FILENAME: 'checks.js', DIRECTORY: '' });
    assert.ok(script.length > 100); assert.strictEqual(script, nfs.readFileSync(npath.join(WWW, 'data/scripts/checks.js'), 'utf8'));
    sys.changeDir({ FOLDER: '..' }); sys.changeDir({ FOLDER: sys.getCwd() + '\\lang' }); assert.ok(sto.readFile({ FILENAME: 'default.txt', DIRECTORY: '' }).length > 1000);
    assert.deepStrictEqual(sto.listFiles({ FOLDER: '.', DIRECTORY: '' }).includes('default.txt'), true); });
  await t('"Rooms//x" lê "rooms/x" (Windows ignora maiúsculas)', () => { const f = fs.readdirSync('/app/data/rooms')[0]; assert.ok(f, 'rooms vazia?'); sys.changeDir({ FOLDER: '/app/data' }); const txt = sto.readFileDataURI({ FILENAME: 'Rooms//' + f.toUpperCase(), DIRECTORY: '' }); assert.ok(txt.startsWith('data:'), 'não leu: ' + txt.slice(0, 30)); });
  await t('chdir para pasta inexistente: o shim lança ENOENT e a extensão original o captura sem mudar a pasta atual', () => { assert.throws(() => M.process.chdir('/app/nao/existe'), (e) => e.code === 'ENOENT'); const antes = sys.getCwd(); sys.changeDir({ FOLDER: '/app/nao/existe' }); assert.strictEqual(sys.getCwd(), antes); });
  await t('caminho de saves do jogo: USERPROFILE\\Appdata -> Local -> Morningstar', () => {
    sys.changeDir({ FOLDER: sys.getEnv({ NAME: 'USERPROFILE' }) + '\\Appdata' }); sys.changeDir({ FOLDER: sys.getCwd() + '\\Local' });
    sto.createFolder({ FOLDERNAME: 'Morningstar', DIRECTORY: '' }); sys.changeDir({ FOLDER: sys.getCwd() + '\\Morningstar' });
    assert.strictEqual(sto.folderExists({ FOLDERNAME: 'UNDERTALE', DIRECTORY: '' }), false); });
  await t('gravar/ler/anexar/existir/listar/apagar saves', () => {
    sto.writeFile({ CONTENT: 'olá ✓ ação', FILENAME: 'file0', DIRECTORY: '' }); assert.strictEqual(sto.readFile({ FILENAME: 'file0', DIRECTORY: '' }), 'olá ✓ ação');
    sto.appendFile({ CONTENT: '+1', FILENAME: 'file0', DIRECTORY: '' }); assert.strictEqual(sto.readFile({ FILENAME: 'file0', DIRECTORY: '' }), 'olá ✓ ação+1');
    sto.writeFile({ CONTENT: 'x', FILENAME: 'sub\\morningstar.ini', DIRECTORY: '' }); assert.strictEqual(sto.fileExists({ FILENAME: 'SUB/MORNINGSTAR.INI', DIRECTORY: '' }), true);
    assert.ok(sto.listFiles({ FOLDER: '.', DIRECTORY: '' }).includes('file0')); assert.ok(sto.listFolders({ FOLDER: '.', DIRECTORY: '' }).includes('sub'));
    sto.copyFile({ SOURCE: 'file0', DEST: 'c_file0', DIRECTORY: '' }); assert.strictEqual(sto.readFile({ FILENAME: 'c_file0', DIRECTORY: '' }), 'olá ✓ ação+1');
    sto.deleteFile({ FILENAME: 'c_file0', DIRECTORY: '' }); assert.strictEqual(sto.fileExists({ FILENAME: 'c_file0', DIRECTORY: '' }), false);
    assert.strictEqual(sto.readFile({ FILENAME: 'inexistente', DIRECTORY: '' }), ''); });
  await t('arquivo do jogo não é perdido por apagar uma cópia gravável', () => { fs.writeFileSync('/app/data/lang/default.txt', 'mod'); assert.strictEqual(fs.readFileSync('/app/data/lang/default.txt', 'utf8'), 'mod'); fs.unlinkSync('/app/data/lang/default.txt'); });

  console.log('persistência (simula fechar e reabrir o app)');
  const before = fs.readFileSync(path.resolve(sys.getCwd(), 'file0'), 'utf8'), where = sys.getCwd();
  await t('saves gravados no IndexedDB', async () => { await M.flush(); assert.ok(idb.files && idb.files.size >= 2, 'nada gravado'); });
  M = loadShim(idb); await M.init();
  await t('após reiniciar, os saves continuam lá (e a pasta de saves também)', () => { assert.strictEqual(M.fs.readFileSync(where + '/file0', 'utf8'), before); assert.ok(M.fs.existsSync(where + '/sub/morningstar.ini')); });
  await t('após reiniciar, um arquivo do pacote apagado continua apagado', () => { assert.throws(() => M.fs.readFileSync('/app/data/lang/default.txt', 'utf8'), (e) => e.code === 'ENOENT'); });
  await t('resetSaves limpa só os saves', async () => { await M.resetSaves(); assert.ok(!M.fs.existsSync(where + '/file0')); assert.ok(M.fs.existsSync('/app/data/scripts/checks.js')); });

  console.log('\n' + pass + ' ok, ' + fail + ' falha(s)'); process.exit(fail ? 1 : 0);
})();
