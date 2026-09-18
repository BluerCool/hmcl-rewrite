/**
 * @hmcl/core — framework-free core of the HMCL TypeScript rewrite:
 * version resolution, downloads, game file management and launching.
 */
export * from './platform/os.js';
export * from './version/types.js';
export * from './version/artifact.js';
export * from './version/library.js';
export * from './version/rules.js';
export * from './version/arguments.js';
export * from './version/versionNumber.js';
export * from './version/resolve.js';
export * from './version/install.js';
export * from './download/mirrors.js';
export * from './download/downloader.js';
export * from './addon/modrinth.js';
export * from './modpack/modpack.js';
export * from './game/repository.js';
export * from './game/assets.js';
export * from './modloaders/fabric.js';
export * from './modloaders/forge.js';
export * from './modloaders/neoforge.js';
export * from './modloaders/optifine.js';
export * from './launch/auth.js';
export * from './auth/microsoft.js';
export * from './auth/account-store.js';
export * from './game/instance-settings.js';
export * from './launch/options.js';
export * from './launch/command.js';
export * from './launch/natives.js';
export * from './launch/launcher.js';
export * from './java/detect.js';
