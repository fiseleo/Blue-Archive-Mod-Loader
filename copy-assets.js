const fs = require('fs-extra');
const path = require('path');

console.log('Copying assets to dist folder...');

const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir);
}



const mainPackageJson = require('./package.json');


const distPackageJson = {
    name: mainPackageJson.name,
    version: mainPackageJson.version,
    description: mainPackageJson.description,
    main: mainPackageJson.main, 
    author: mainPackageJson.author,
    license: mainPackageJson.license,
    dependencies: mainPackageJson.dependencies 
};


fs.writeFileSync(
    path.join(distDir, 'package.json'),
    JSON.stringify(distPackageJson, null, 2) 
);
console.log('Generated clean package.json for dist.');


const assetsToCopy = [
    'index.html',
    'locales'
];

assetsToCopy.forEach(asset => {
    const srcPath = path.join(__dirname, asset);
    const destPath = path.join(distDir, asset);
    if (fs.existsSync(srcPath)) {
        fs.copySync(srcPath, destPath);
        console.log(`Copied asset: ${asset}`);
    }
});


const patcherFile = 'crc_patcher.js';
const patcherSrcPath = path.join(__dirname, patcherFile);
if (fs.existsSync(patcherSrcPath)) {
    fs.copySync(patcherSrcPath, path.join(distDir, patcherFile));
    console.log('Copied secret CRC patcher module.');
} else {
    console.warn('CRC patcher module not found, packaged app will not have CRC functionality.');
}

console.log('Asset copying finished.');