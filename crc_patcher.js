const fs = require('fs').promises;
const path = require('path'); 



function bytes_to_u32_be(b) {
    return b.readUInt32BE(0);
}

function u32_to_bytes_be(i) {
    const buf = Buffer.alloc(4);
    if (typeof i === 'bigint') {
        buf.writeUInt32BE(Number(i & 0xFFFFFFFFn), 0);
    } else {
        buf.writeUInt32BE(i, 0);
    }
    return buf;
}

function reverse_bits_in_bytes(b) {
    const num = bytes_to_u32_be(b);
    let rev = 0;
    for (let i = 0; i < 32; i++) {
        if ((num >> i) & 1) {
            rev |= 1 << (31 - i);
        }
    }
    return u32_to_bytes_be(rev >>> 0);
}

function gf_multiply(a, b) {
    let result = 0n;
    while (b > 0n) {
        if (b & 1n) {
            result ^= a;
        }
        a <<= 1n;
        b >>= 1n;
    }
    return result;
}

function gf_divide(dividend, divisor) {
    if (divisor === 0n) return 0n;
    let quotient = 0n;
    let remainder = dividend;
    const divisor_bits = BigInt(divisor.toString(2).length);
    while (remainder.toString(2).length >= divisor_bits && remainder !== 0n) {
        const shift = BigInt(remainder.toString(2).length) - divisor_bits;
        quotient |= 1n << shift;
        remainder ^= divisor << shift;
    }
    return quotient;
}

function gf_mod(dividend, divisor) {
    if (divisor === 0n) return dividend;
    const divisor_bits = BigInt(divisor.toString(2).length);
    while (dividend !== 0n && dividend.toString(2).length >= divisor_bits) {
        const shift = BigInt(dividend.toString(2).length) - divisor_bits;
        dividend ^= divisor << shift;
    }
    return dividend;
}

function gf_multiply_modular(a, b, modulus) {
    const product = gf_multiply(a, b);
    return gf_mod(product, modulus);
}

function gf_modular_inverse(a, m) {
    if (a === 0n) throw new Error("Inverse of zero does not exist");
    let [old_r, r] = [m, a];
    let [old_s, s] = [0n, 1n];
    while (r !== 0n) {
        const q = gf_divide(old_r, r);
        [old_r, r] = [r, old_r ^ gf_multiply(q, r)];
        [old_s, s] = [s, old_s ^ gf_multiply(q, s)];
    }
    if (old_r !== 1n) throw new Error("Modular inverse does not exist");
    return old_s;
}

function gf_inverse(k, poly) {
    const x32 = 0x100000000n;
    const inverse = gf_modular_inverse(x32, poly);
    return gf_multiply_modular(k, inverse, poly);
}

let crc32Table;

function makeCrc32Table() {
    crc32Table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        crc32Table[i] = c;
    }
}

function compute_crc32(data) {
    if (!crc32Table) makeCrc32Table();
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function xor_bytes(a, b) {
    const length = Math.min(a.length, b.length);
    const result = Buffer.alloc(length);
    for (let i = 0; i < length; i++) {
        result[i] = a[i] ^ b[i];
    }
    return result;
}

async function manipulate_crc(original_path, mod_path, target_path = null) {
    try {
        // 如果只傳入兩個參數，保持舊的行為（向後兼容）
        if (target_path === null) {
            target_path = mod_path;
            mod_path = mod_path;
        }

        const original_data = await fs.readFile(original_path);
        const mod_data = await fs.readFile(mod_path);

        const original_crc = compute_crc32(original_data);
        const mod_crc = compute_crc32(mod_data);

        // 詳細顯示 CRC 信息用於調試
        console.log(`=== CRC DEBUG INFO ===`);
        console.log(`File: ${path.basename(target_path)}`);
        console.log(`Original file: ${original_path}`);
        console.log(`Mod file: ${mod_path}`);
        console.log(`Target file: ${target_path}`);
        console.log(`Original CRC: 0x${original_crc.toString(16).toUpperCase()} (${original_crc})`);
        console.log(`Mod CRC: 0x${mod_crc.toString(16).toUpperCase()} (${mod_crc})`);
        console.log(`Original file size: ${original_data.length} bytes`);
        console.log(`Mod file size: ${mod_data.length} bytes`);
        console.log(`=== END DEBUG INFO ===`);

        // 如果 mod 檔案和原始檔案的 CRC 相同，則直接複製
        if (mod_crc === original_crc) {
            console.log(`Mod CRC matches original CRC for "${path.basename(target_path)}". Copying without patch.`);
            await fs.writeFile(target_path, mod_data);
            return true;
        }

        console.log(`CRC mismatch for "${path.basename(target_path)}". Original: ${original_crc.toString(16)}, Mod: ${mod_crc.toString(16)}. Starting patch...`);

        const modified_crc_with_padding = compute_crc32(Buffer.concat([mod_data, Buffer.alloc(4)]));

        const original_bytes = u32_to_bytes_be(original_crc);
        const modified_bytes = u32_to_bytes_be(modified_crc_with_padding);

        const xor_result = xor_bytes(original_bytes, modified_bytes);
        const reversed_bytes = reverse_bits_in_bytes(xor_result);
        const k = BigInt(bytes_to_u32_be(reversed_bytes));

        const crc32_poly = 0x104C11DB7n;
        const correction_value = gf_inverse(k, crc32_poly);

        const correction_bytes_raw = u32_to_bytes_be(correction_value);
        const reverse_byte_bits = (byte) => parseInt(byte.toString(2).padStart(8, '0').split('').reverse().join(''), 2);
        const correction_bytes = Buffer.from([...correction_bytes_raw].map(b => reverse_byte_bits(b)));

        const final_data = Buffer.concat([mod_data, correction_bytes]);
        const final_crc = compute_crc32(final_data);

        if (final_crc === original_crc) {
            // 將修正後的數據寫入目標路徑
            await fs.writeFile(target_path, final_data);
            console.log(`Successfully patched CRC for "${path.basename(target_path)}". New CRC: ${final_crc.toString(16)}`);
            return true;
        }

        console.warn(`CRC patching FAILED for "${path.basename(target_path)}". Final CRC (${final_crc.toString(16)}) did not match original CRC (${original_crc.toString(16)}).`);
        return false;
    } catch (err) {
        console.error(`CRC manipulation process failed for ${target_path}:`, err);
        return false;
    }
}


module.exports = {
    manipulate_crc,
};