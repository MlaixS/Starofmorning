
(function() {
(function(Scratch) {
    'use strict';

    const fs = require('fs');
    const path = require('path');

    const BlockType = Scratch.BlockType;
    const ArgumentType = Scratch.ArgumentType;

    const _nodeStorageMimeTypes = {
        txt: 'text/plain', json: 'application/json', png: 'image/png',
        jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
        webp: 'image/webp', svg: 'image/svg+xml', mp3: 'audio/mpeg',
        ogg: 'audio/ogg', opus: 'audio/x-wav', wav: 'audio/wav',
        mp4: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf'
    };
    // Path resolution cache: avoids repeated path.resolve() syscall overhead for the same string.
    // IMPORTANT: path.resolve() results depend on process.cwd(), so this cache must be
    // invalidated whenever the working directory changes (see changeDir in NodeSystemChunk2),
    // otherwise blocks will keep resolving filenames against a stale directory.
    //
    // Every file/folder block also accepts an optional DIRECTORY argument now. When
    // it's given, the path resolves against THAT directory instead of process.cwd(),
    // so concurrent scripts that each pass their own DIRECTORY never fight over the
    // shared global cwd. (This is what used to break: two scripts reading from
    // different folders "at once" both relied on the single global cwd, so a
    // "change directory to" from one script could flip the base out from under the
    // other script's in-flight read/write, silently corrupting or skipping it.)
    // When DIRECTORY is left blank, behavior is unchanged: resolve against the
    // current global working directory.
    //
    // The cache key includes the resolved base directory so entries for different
    // bases never collide with each other or go stale into one another.
    let _pathCacheCwd = process.cwd();
    const _pathCache = new Map();
    const _resolvePath = (f, dir) => {
        const base = (dir !== undefined && dir !== null && dir !== '') ? path.resolve(dir) : process.cwd();
        if (process.cwd() !== _pathCacheCwd) {
            // cwd changed since we last cached anything - stale cwd-relative entries, wipe them
            _pathCache.clear();
            _pathCacheCwd = process.cwd();
        }
        const key = base + '\u0000' + f;
        let p = _pathCache.get(key);
        if (p === undefined) { p = path.resolve(base, f); _pathCache.set(key, p); }
        return p;
    };
    // Invalidate every cached resolution of a given filename, regardless of which
    // base directory it was resolved against (used after writes/deletes/renames).
    const _invalidatePath = (f) => {
        for (const k of _pathCache.keys()) { if (k.endsWith('\u0000' + f)) _pathCache.delete(k); }
    };

    // ---- App-bundle (asar) path resolution ----
    // In a packaged Electron app the project's own JS/HTML/assets live inside
    // "<resourcesPath>/app.asar", not on cwd. Electron's patched `fs` can read
    // straight out of app.asar transparently (treats it like a real folder),
    // as long as the asar wasn't disabled and the target file isn't one that
    // was explicitly unpacked (those live in "app.asar.unpacked" instead).
    // process.resourcesPath is only defined when running under Electron; fall
    // back to cwd in dev/browser contexts so these blocks don't hard-crash.
    const _appBase = (typeof process.resourcesPath === 'string')
        ? path.join(process.resourcesPath, 'app.asar')
        : process.cwd();
    const _appUnpackedBase = (typeof process.resourcesPath === 'string')
        ? path.join(process.resourcesPath, 'app.asar.unpacked')
        : process.cwd();

    // Separate cache from _resolvePath's since this never depends on cwd.
    const _appPathCache = new Map();
    const _resolveAppPath = (f, unpacked) => {
        const base = unpacked ? _appUnpackedBase : _appBase;
        const key = (unpacked ? 'u:' : 'p:') + f;
        let p = _appPathCache.get(key);
        if (p === undefined) { p = path.join(base, f); _appPathCache.set(key, p); }
        return p;
    };

    class NodeStorageChunk1 {
        getInfo() {
            return {
                id: 'nodeStorageChunk1',
                name: 'Node Storage (Chunk 1)',
                blocks: [
                    {
                        opcode: 'writeFile',
                        blockType: BlockType.COMMAND,
                        text: 'write [CONTENT] to file [FILENAME] in directory [DIRECTORY]',
                        arguments: {
                            CONTENT: { type: ArgumentType.STRING, defaultValue: 'Hello World' },
                            FILENAME: { type: ArgumentType.STRING, defaultValue: 'test.txt' },
                            DIRECTORY: { type: ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    {
                        opcode: 'appendFile',
                        blockType: BlockType.COMMAND,
                        text: 'append [CONTENT] to file [FILENAME] in directory [DIRECTORY]',
                        arguments: {
                            CONTENT: { type: ArgumentType.STRING, defaultValue: 'Append this' },
                            FILENAME: { type: ArgumentType.STRING, defaultValue: 'test.txt' },
                            DIRECTORY: { type: ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    {
                        opcode: 'readFile',
                        blockType: BlockType.REPORTER,
                        text: 'read file [FILENAME] in directory [DIRECTORY]',
                        arguments: {
                            FILENAME: { type: ArgumentType.STRING, defaultValue: 'test.txt' },
                            DIRECTORY: { type: ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    {
                        opcode: 'readFileDataURI',
                        blockType: BlockType.REPORTER,
                        text: 'read file [FILENAME] in directory [DIRECTORY] as data uri',
                        arguments: {
                            FILENAME: { type: ArgumentType.STRING, defaultValue: 'test.txt' },
                            DIRECTORY: { type: ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    {
                        opcode: 'deleteFile',
                        blockType: BlockType.COMMAND,
                        text: 'delete file [FILENAME] in directory [DIRECTORY]',
                        arguments: {
                            FILENAME: { type: ArgumentType.STRING, defaultValue: 'test.txt' },
                            DIRECTORY: { type: ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    {
                        opcode: 'fileExists',
                        blockType: BlockType.BOOLEAN,
                        text: 'file exists [FILENAME] in directory [DIRECTORY] ?',
                        arguments: {
                            FILENAME: { type: ArgumentType.STRING, defaultValue: 'test.txt' },
                            DIRECTORY: { type: ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    {
                        opcode: 'copyFile',
                        blockType: BlockType.COMMAND,
                        text: 'copy file [SOURCE] to [DEST] in directory [DIRECTORY]',
                        arguments: {
                            SOURCE: { type: ArgumentType.STRING, defaultValue: 'test.txt' },
                            DEST: { type: ArgumentType.STRING, defaultValue: 'copy.txt' },
                            DIRECTORY: { type: ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    {
                        opcode: 'moveFile',
                        blockType: BlockType.COMMAND,
                        text: 'move file [SOURCE] to [DEST] in directory [DIRECTORY]',
                        arguments: {
                            SOURCE: { type: ArgumentType.STRING, defaultValue: 'test.txt' },
                            DEST: { type: ArgumentType.STRING, defaultValue: 'moved.txt' },
                            DIRECTORY: { type: ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    {
                        opcode: 'createFolder',
                        blockType: BlockType.COMMAND,
                        text: 'create folder [FOLDERNAME] in directory [DIRECTORY]',
                        arguments: {
                            FOLDERNAME: { type: ArgumentType.STRING, defaultValue: 'NewFolder' },
                            DIRECTORY: { type: ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    {
                        opcode: 'deleteFolder',
                        blockType: BlockType.COMMAND,
                        text: 'delete folder [FOLDERNAME] in directory [DIRECTORY]',
                        arguments: {
                            FOLDERNAME: { type: ArgumentType.STRING, defaultValue: 'NewFolder' },
                            DIRECTORY: { type: ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    {
                        opcode: 'folderExists',
                        blockType: BlockType.BOOLEAN,
                        text: 'folder exists [FOLDERNAME] in directory [DIRECTORY] ?',
                        arguments: {
                            FOLDERNAME: { type: ArgumentType.STRING, defaultValue: 'NewFolder' },
                            DIRECTORY: { type: ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    {
                        opcode: 'listFiles',
                        blockType: BlockType.REPORTER,
                        text: 'list files in folder [FOLDER] in directory [DIRECTORY]',
                        arguments: {
                            FOLDER: { type: ArgumentType.STRING, defaultValue: '.' },
                            DIRECTORY: { type: ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    {
                        opcode: 'listFolders',
                        blockType: BlockType.REPORTER,
                        text: 'list folders in folder [FOLDER] in directory [DIRECTORY]',
                        arguments: {
                            FOLDER: { type: ArgumentType.STRING, defaultValue: '.' },
                            DIRECTORY: { type: ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    {
                        opcode: 'readFileAsync',
                        blockType: BlockType.REPORTER,
                        text: 'read file [FILENAME] in directory [DIRECTORY] (async)',
                        arguments: {
                            FILENAME: { type: ArgumentType.STRING, defaultValue: 'test.txt' },
                            DIRECTORY: { type: ArgumentType.STRING, defaultValue: '' }
                        }
                    },
                    '---',
                    {
                        opcode: 'readAppFile',
                        blockType: BlockType.REPORTER,
                        text: 'read app file [RELPATH] [UNPACKED]',
                        arguments: {
                            RELPATH: { type: ArgumentType.STRING, defaultValue: 'index.html' },
                            UNPACKED: { type: ArgumentType.STRING, menu: 'unpackedMenu', defaultValue: 'bundled' }
                        }
                    },
                    {
                        opcode: 'readAppFileDataURI',
                        blockType: BlockType.REPORTER,
                        text: 'read app file [RELPATH] [UNPACKED] as data uri',
                        arguments: {
                            RELPATH: { type: ArgumentType.STRING, defaultValue: 'assets/logo.png' },
                            UNPACKED: { type: ArgumentType.STRING, menu: 'unpackedMenu', defaultValue: 'bundled' }
                        }
                    },
                    {
                        opcode: 'appFileExists',
                        blockType: BlockType.BOOLEAN,
                        text: 'app file exists [RELPATH] [UNPACKED] ?',
                        arguments: {
                            RELPATH: { type: ArgumentType.STRING, defaultValue: 'index.html' },
                            UNPACKED: { type: ArgumentType.STRING, menu: 'unpackedMenu', defaultValue: 'bundled' }
                        }
                    },
                    {
                        opcode: 'listAppFiles',
                        blockType: BlockType.REPORTER,
                        text: 'list files in app folder [RELPATH] [UNPACKED]',
                        arguments: {
                            RELPATH: { type: ArgumentType.STRING, defaultValue: '.' },
                            UNPACKED: { type: ArgumentType.STRING, menu: 'unpackedMenu', defaultValue: 'bundled' }
                        }
                    },
                    {
                        opcode: 'appResourcesPath',
                        blockType: BlockType.REPORTER,
                        text: 'app resources path'
                    }
                ],
                menus: {
                    unpackedMenu: {
                        acceptReporters: true,
                        items: ['bundled', 'unpacked']
                    }
                }
            };
        }

        writeFile({ CONTENT, FILENAME, DIRECTORY }) {
            // Invalidate path cache entry so reads see the new file immediately
            _invalidatePath(FILENAME);
            const p = _resolvePath(FILENAME, DIRECTORY);
            try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch {}
            fs.writeFileSync(p, CONTENT);
        }

        appendFile({ CONTENT, FILENAME, DIRECTORY }) {
            const p = _resolvePath(FILENAME, DIRECTORY);
            try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch {}
            fs.appendFileSync(p, CONTENT);
        }

        readFile({ FILENAME, DIRECTORY }) {
            const p = _resolvePath(FILENAME, DIRECTORY);
            try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
        }

        // Kept as a block for compatibility with existing projects, but now
        // just calls the sync read directly — all file ops in this
        // extension are synchronous, so writeFile is guaranteed to have
        // finished before any later block runs.
        readFileAsync({ FILENAME, DIRECTORY }) {
            const p = _resolvePath(FILENAME, DIRECTORY);
            try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
        }

        readFileDataURI({ FILENAME, DIRECTORY }) {
            // NOTE: Prefer Asset Manager's "add costume/sound from file [PATH]"
            // blocks when the goal is to load a costume or sound — those read
            // the file once with fs and hand raw bytes straight to
            // runtime.storage.createAsset, skipping this base64 encode/decode
            // round trip entirely. This block is still useful for cases that
            // genuinely need a data: URI string (e.g. an <img> src, a
            // GUI extension expecting a string), so it's kept as-is.
            const p = _resolvePath(FILENAME, DIRECTORY);
            try { fs.accessSync(p); } catch { return ''; }
            const buffer = fs.readFileSync(p);
            const ext = path.extname(p).slice(1).toLowerCase();
            const mime = _nodeStorageMimeTypes[ext] || 'application/octet-stream';
            return `data:${mime};base64,${buffer.toString('base64')}`;
        }

        deleteFile({ FILENAME, DIRECTORY }) {
            _invalidatePath(FILENAME);
            try { fs.unlinkSync(_resolvePath(FILENAME, DIRECTORY)); } catch {}
        }

        fileExists({ FILENAME, DIRECTORY }) {
            try { fs.accessSync(_resolvePath(FILENAME, DIRECTORY)); return true; } catch { return false; }
        }

        copyFile({ SOURCE, DEST, DIRECTORY }) {
            fs.copyFileSync(_resolvePath(SOURCE, DIRECTORY), _resolvePath(DEST, DIRECTORY));
        }

        moveFile({ SOURCE, DEST, DIRECTORY }) {
            _invalidatePath(SOURCE);
            try { fs.renameSync(_resolvePath(SOURCE, DIRECTORY), _resolvePath(DEST, DIRECTORY)); } catch {}
        }

        createFolder({ FOLDERNAME, DIRECTORY }) {
            try { fs.mkdirSync(_resolvePath(FOLDERNAME, DIRECTORY), { recursive: true }); } catch {}
        }

        deleteFolder({ FOLDERNAME, DIRECTORY }) {
            _invalidatePath(FOLDERNAME);
            const p = _resolvePath(FOLDERNAME, DIRECTORY);
            if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
        }

        folderExists({ FOLDERNAME, DIRECTORY }) {
            try { return fs.statSync(_resolvePath(FOLDERNAME, DIRECTORY)).isDirectory(); } catch { return false; }
        }

        listFiles({ FOLDER, DIRECTORY }) {
            try {
                const entries = fs.readdirSync(_resolvePath(FOLDER, DIRECTORY), { withFileTypes: true });
                const result = [];
                for (let i = 0; i < entries.length; i++) { if (entries[i].isFile()) result.push(entries[i].name); }
                return result;
            } catch { return []; }
        }

        listFolders({ FOLDER, DIRECTORY }) {
            try {
                const entries = fs.readdirSync(_resolvePath(FOLDER, DIRECTORY), { withFileTypes: true });
                const result = [];
                for (let i = 0; i < entries.length; i++) { if (entries[i].isDirectory()) result.push(entries[i].name); }
                return result;
            } catch { return []; }
        }

        // ---- App-bundle (asar) readers ----
        // Read-only by design: writing into app.asar isn't possible (it's a
        // packed archive), and app.asar.unpacked ships as part of the install
        // so writing there would just be a confusing way to lose your changes
        // on the next update. Use the regular writeFile/appendFile blocks
        // (which target cwd, e.g. userData) for anything that needs to persist.
        readAppFile({ RELPATH, UNPACKED }) {
            const p = _resolveAppPath(RELPATH, UNPACKED === 'unpacked');
            try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
        }

        readAppFileDataURI({ RELPATH, UNPACKED }) {
            const p = _resolveAppPath(RELPATH, UNPACKED === 'unpacked');
            try { fs.accessSync(p); } catch { return ''; }
            const buffer = fs.readFileSync(p);
            const ext = path.extname(p).slice(1).toLowerCase();
            const mime = _nodeStorageMimeTypes[ext] || 'application/octet-stream';
            return `data:${mime};base64,${buffer.toString('base64')}`;
        }

        appFileExists({ RELPATH, UNPACKED }) {
            try { fs.accessSync(_resolveAppPath(RELPATH, UNPACKED === 'unpacked')); return true; } catch { return false; }
        }

        listAppFiles({ RELPATH, UNPACKED }) {
            try {
                const entries = fs.readdirSync(_resolveAppPath(RELPATH, UNPACKED === 'unpacked'), { withFileTypes: true });
                const result = [];
                for (let i = 0; i < entries.length; i++) { if (entries[i].isFile()) result.push(entries[i].name); }
                return result;
            } catch { return []; }
        }

        appResourcesPath() {
            return typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
        }
    }

    Scratch.extensions.register(new NodeStorageChunk1());
})(Scratch);
})();

