const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

console.log('Starting obfuscation process...');

// 準備一個乾淨的輸出目錄
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir);

// 定義要混淆的檔案列表
const filesToObfuscate = [
    'main.js',
    'renderer.js',
    'preload.js',
    'crc-patcher.js',
];

// 混淆選項 (可以提供很強的保護)
const obfuscatorOptions = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 1,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 1,
    debugProtection: true,
    debugProtectionInterval: 4000,
    disableConsoleOutput: true,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: true,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 5,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['rc4'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 5,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 5,
    stringArrayWrappersType: 'function',
    transformObjectKeys: true,
    unicodeEscapeSequence: false
};

// 執行混淆
filesToObfuscate.forEach(fileName => {
    const filePath = path.join(__dirname, fileName);
    if (!fs.existsSync(filePath)) {
        console.warn(`File not found, skipping: ${fileName}`);
        return;
    }

    const sourceCode = fs.readFileSync(filePath, 'utf8');
    const obfuscationResult = JavaScriptObfuscator.obfuscate(sourceCode, obfuscatorOptions);
    
    const obfuscatedCode = obfuscationResult.getObfuscatedCode();
    fs.writeFileSync(path.join(distDir, fileName), obfuscatedCode);
    console.log(`Successfully obfuscated: ${fileName}`);
});

console.log('Obfuscation process finished.');