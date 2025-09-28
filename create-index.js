const fs = require('fs');
const path = require('path');
const https = require('https');

console.log('Creating Blue Archive Student Index...');

// URLs for student data
const dataUrls = {
    en: 'https://schaledb.com/data/en/students.json',
    tw: 'https://schaledb.com/data/tw/students.json',
    cn: 'https://schaledb.com/data/cn/students.json'
};

// Function to download JSON data
function downloadJSON(url, progressCallback = null) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            const totalLength = parseInt(res.headers['content-length'], 10) || 0;
            let downloadedLength = 0;
            
            res.on('data', (chunk) => {
                data += chunk;
                downloadedLength += chunk.length;
                if (progressCallback && totalLength > 0) {
                    const progress = Math.round((downloadedLength / totalLength) * 100);
                    progressCallback(progress);
                }
            });
            
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (error) {
                    reject(error);
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

async function createStudentIndex(outputPath = null, progressCallback = null) {
    const studentIndex = {};
    
    try {
        if (progressCallback) progressCallback('正在下載學生資料...', 10);
        console.log('Downloading student data...');
        
        let completedDownloads = 0;
        const totalDownloads = 3;
        
        const downloadProgress = (url, progress) => {
            const overallProgress = Math.floor(((completedDownloads + progress / 100) / totalDownloads) * 30) + 10;
            if (progressCallback) {
                progressCallback(`正在下載 ${url.includes('/en/') ? '英文' : url.includes('/tw/') ? '繁中' : '簡中'}資料... ${progress}%`, overallProgress);
            }
        };
        
        // Download all language data with progress tracking
        const enDataPromise = downloadJSON(dataUrls.en, (progress) => downloadProgress(dataUrls.en, progress))
            .then(data => { completedDownloads++; return data; });
        const twDataPromise = downloadJSON(dataUrls.tw, (progress) => downloadProgress(dataUrls.tw, progress))
            .then(data => { completedDownloads++; return data; });
        const cnDataPromise = downloadJSON(dataUrls.cn, (progress) => downloadProgress(dataUrls.cn, progress))
            .then(data => { completedDownloads++; return data; });
            
        const [enData, twData, cnData] = await Promise.all([
            enDataPromise,
            twDataPromise,
            cnDataPromise
        ]);
        
        if (progressCallback) progressCallback('正在處理學生資料...', 50);
        console.log('Processing student data...');
        
        // Process each student
        const studentEntries = Object.entries(enData);
        const totalStudents = studentEntries.length;
        let processedStudents = 0;
        
        for (const [studentId, studentData] of studentEntries) {
            const devName = studentData.DevName;
            const enName = studentData.Name;
            const twName = twData[studentId]?.Name || enName;
            const cnName = cnData[studentId]?.Name || enName;
            
            if (devName) {
                // Create index entry
                studentIndex[devName.toLowerCase()] = {
                    devName: devName,
                    names: {
                        en: enName,
                        tw: twName,
                        cn: cnName
                    },
                    id: studentId
                };
                
                console.log(`Indexed: ${devName} -> EN: ${enName}, TW: ${twName}, CN: ${cnName}`);
            }
            
            processedStudents++;
            const progress = Math.floor((processedStudents / totalStudents) * 30) + 50;
            if (progressCallback && processedStudents % 10 === 0) {
                progressCallback(`正在處理學生資料... ${processedStudents}/${totalStudents}`, progress);
            }
        }
        
        // Determine output path
        const indexPath = outputPath || path.join(__dirname, 'student-index.json');
        
        if (progressCallback) progressCallback('正在儲存索引檔案...', 90);
        
        // Ensure directory exists
        const dir = path.dirname(indexPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Save index file
        fs.writeFileSync(indexPath, JSON.stringify(studentIndex, null, 2));
        
        if (progressCallback) progressCallback('索引建立完成！', 100);
        
        console.log(`Student index created successfully!`);
        console.log(`Total students indexed: ${Object.keys(studentIndex).length}`);
        console.log(`Index saved to: ${indexPath}`);
        
        return studentIndex;
        
    } catch (error) {
        console.error('Error creating student index:', error);
        throw error;
    }
}

// Run if this file is executed directly
if (require.main === module) {
    createStudentIndex().catch(console.error);
}

module.exports = { createStudentIndex, downloadJSON };
