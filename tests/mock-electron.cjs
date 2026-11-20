// Remplace le module « electron » pour exécuter le moteur agent hors d'Electron (tests).
const Module = require('module')
const os = require('os')
const path = require('path')

const userData = path.join(os.tmpdir(), 'appforge-tests', 'userData')
const orig = Module._load
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return {
      app: { getPath: () => userData },
      safeStorage: { isEncryptionAvailable: () => false },
      powerSaveBlocker: { start: () => 1, stop: () => {}, isStarted: () => false },
      Notification: class {
        static isSupported() {
          return false
        }
        show() {}
      }
    }
  }
  return orig.call(this, request, ...rest)
}
module.exports = { userData }
