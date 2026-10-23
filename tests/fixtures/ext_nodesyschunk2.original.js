
(function() {
(function(Scratch) {
    'use strict';

    // Explicitly require Node core modules
    const os = require('os');
    const path = require('path');
    const process = require('process');

    class NodeSystemChunk2 {
        getInfo() {
            return {
                id: 'nodeSystemChunk2',
                name: 'Node System (Chunk 2)',
                blocks: [
                    { opcode: 'getCwd', blockType: 'reporter', text: 'current working directory' },
                    { opcode: 'changeDir', blockType: 'command', text: 'change directory to [FOLDER]',
                      arguments: { FOLDER: { type: 'string', defaultValue: '.' } } },
                    { opcode: 'getOsType', blockType: 'reporter', text: 'get OS type' },
                    { opcode: 'getPlatform', blockType: 'reporter', text: 'get OS platform' },
                    { opcode: 'getCpuArch', blockType: 'reporter', text: 'get CPU architecture' },
                    { opcode: 'getTotalMem', blockType: 'reporter', text: 'get total memory' },
                    { opcode: 'getFreeMem', blockType: 'reporter', text: 'get free memory' },
                    { opcode: 'getUptime', blockType: 'reporter', text: 'get uptime (seconds)' },
                    { opcode: 'getEnv', blockType: 'reporter', text: 'get environment variable [NAME]',
                      arguments: { NAME: { type: 'string', defaultValue: 'PATH' } } },
                    { opcode: 'setEnv', blockType: 'command', text: 'set environment variable [NAME] to [VALUE]',
                      arguments: { NAME: { type: 'string', defaultValue: 'MY_VAR' }, VALUE: { type: 'string', defaultValue: '' } } },
                    { opcode: 'deleteEnv', blockType: 'command', text: 'delete environment variable [NAME]',
                      arguments: { NAME: { type: 'string', defaultValue: 'MY_VAR' } } },
                    { opcode: 'listEnv', blockType: 'reporter', text: 'list all environment variables' }
                ]
            };
        }

        getCwd() { return process.cwd(); }
        changeDir({ FOLDER }) {
            try {
                // path.resolve(FOLDER) resolves relative to the CURRENT process.cwd(),
                // which is exactly what we want for a relative "cd" (including "..").
                process.chdir(path.resolve(FOLDER));
            } catch (e) {
                console.error("[Node System] changeDir failed:", e.message);
            }
        }
        getOsType() { return os.type(); }
        getPlatform() { return os.platform(); }
        getCpuArch() { return os.arch(); }
        getTotalMem() { return os.totalmem(); }
        getFreeMem() { return os.freemem(); }
        getUptime() { return os.uptime(); }
        getEnv({ NAME }) { return process.env[NAME] || ''; }
        setEnv({ NAME, VALUE }) { process.env[NAME] = VALUE; }
        deleteEnv({ NAME }) { delete process.env[NAME]; }
        listEnv() { return Object.entries(process.env).map(([k,v]) => `${k}=${v}`).join('\n'); }
    }

    Scratch.extensions.register(new NodeSystemChunk2());
})(Scratch);
})();

