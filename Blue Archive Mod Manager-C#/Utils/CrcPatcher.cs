using System;
using System.IO;
using System.Numerics;
using System.Threading.Tasks;

namespace Blue_Archive_Mod_Manager_C_.Utils
{
    public static class CrcPatcher
    {
        private static readonly uint[] Crc32Table = CreateCrc32Table();

        private static uint[] CreateCrc32Table()
        {
            var table = new uint[256];
            for (uint i = 0; i < 256; i++)
            {
                uint c = i;
                for (int j = 0; j < 8; j++)
                {
                    c = (c & 1) != 0 ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
                }
                table[i] = c;
            }
            return table;
        }

        private static uint ComputeCrc32(ReadOnlySpan<byte> data)
        {
            uint crc = 0xFFFFFFFF;
            foreach (var b in data)
            {
                crc = Crc32Table[(crc ^ b) & 0xFF] ^ (crc >> 8);
            }
            return crc ^ 0xFFFFFFFFu;
        }

        private static byte[] UInt32ToBytesBE(BigInteger value)
        {
            uint v = (uint)(value & 0xFFFFFFFF);
            return new[]
            {
                (byte)((v >> 24) & 0xFF),
                (byte)((v >> 16) & 0xFF),
                (byte)((v >> 8) & 0xFF),
                (byte)(v & 0xFF)
            };
        }

        private static uint BytesToUInt32BE(ReadOnlySpan<byte> b)
        {
            return (uint)(b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]);
        }

        private static byte[] ReverseBitsInBytes(ReadOnlySpan<byte> input)
        {
            uint num = BytesToUInt32BE(input);
            uint rev = 0;
            for (int i = 0; i < 32; i++)
            {
                if (((num >> i) & 1) == 1)
                {
                    rev |= 1u << (31 - i);
                }
            }
            return UInt32ToBytesBE(rev);
        }

        private static byte[] XorBytes(ReadOnlySpan<byte> a, ReadOnlySpan<byte> b)
        {
            int len = Math.Min(a.Length, b.Length);
            var result = new byte[len];
            for (int i = 0; i < len; i++)
            {
                result[i] = (byte)(a[i] ^ b[i]);
            }
            return result;
        }

        private static int BitLength(BigInteger value)
        {
            int bits = 0;
            var v = value;
            while (v > 0)
            {
                v >>= 1;
                bits++;
            }
            return bits;
        }

        private static BigInteger GfMultiply(BigInteger a, BigInteger b)
        {
            BigInteger result = 0;
            var x = a;
            var y = b;
            while (y > 0)
            {
                if ((y & 1) != 0) result ^= x;
                x <<= 1;
                y >>= 1;
            }
            return result;
        }

        private static BigInteger GfMod(BigInteger dividend, BigInteger divisor)
        {
            if (divisor == 0) return dividend;
            int divisorBits = BitLength(divisor);
            var d = dividend;
            while (d != 0 && BitLength(d) >= divisorBits)
            {
                int shift = BitLength(d) - divisorBits;
                d ^= divisor << shift;
            }
            return d;
        }

        private static BigInteger GfMultiplyModular(BigInteger a, BigInteger b, BigInteger modulus)
        {
            return GfMod(GfMultiply(a, b), modulus);
        }

        private static BigInteger GfDivide(BigInteger dividend, BigInteger divisor)
        {
            if (divisor == 0) return 0;
            BigInteger quotient = 0;
            BigInteger remainder = dividend;
            int divisorBits = BitLength(divisor);
            while (remainder != 0 && BitLength(remainder) >= divisorBits)
            {
                int shift = BitLength(remainder) - divisorBits;
                quotient |= BigInteger.One << shift;
                remainder ^= divisor << shift;
            }
            return quotient;
        }

        private static BigInteger GfModularInverse(BigInteger a, BigInteger modulus)
        {
            if (a == 0) throw new InvalidOperationException("Inverse of zero does not exist");

            BigInteger oldR = modulus, r = a;
            BigInteger oldS = 0, s = 1;

            while (r != 0)
            {
                var q = GfDivide(oldR, r);
                (oldR, r) = (r, oldR ^ GfMultiply(q, r));
                (oldS, s) = (s, oldS ^ GfMultiply(q, s));
            }

            if (oldR != 1) throw new InvalidOperationException("Modular inverse does not exist");
            return oldS;
        }

        private static BigInteger GfInverse(BigInteger k, BigInteger poly)
        {
            BigInteger x32 = 0x100000000;
            var inverse = GfModularInverse(x32, poly);
            return GfMultiplyModular(k, inverse, poly);
        }

        public static async Task<bool> ManipulateCrcAsync(string originalPath, string modPath, string targetPath, Action<string>? log = null)
        {
            try
            {
                if (!File.Exists(originalPath) || !File.Exists(modPath)) return false;

                var originalData = await File.ReadAllBytesAsync(originalPath);
                var modData = await File.ReadAllBytesAsync(modPath);

                var originalCrc = ComputeCrc32(originalData);
                var modCrc = ComputeCrc32(modData);

                log?.Invoke($"Original CRC: 0x{originalCrc:X8}, Mod CRC: 0x{modCrc:X8}");

                if (modCrc == originalCrc)
                {
                    await File.WriteAllBytesAsync(targetPath, modData);
                    log?.Invoke("CRC match, copied mod without patch.");
                    return true;
                }

                var modifiedCrcWithPadding = ComputeCrc32(new ReadOnlySpan<byte>(Concat(modData, new byte[4])));

                var originalBytes = UInt32ToBytesBE(originalCrc);
                var modifiedBytes = UInt32ToBytesBE(modifiedCrcWithPadding);

                var xorResult = XorBytes(originalBytes, modifiedBytes);
                var reversedBytes = ReverseBitsInBytes(xorResult);
                var k = new BigInteger(BytesToUInt32BE(reversedBytes));

                var crc32Poly = new BigInteger(0x104C11DB7);
                var correctionValue = GfInverse(k, crc32Poly);

                var correctionBytesRaw = UInt32ToBytesBE(correctionValue);
                byte ReverseBits(byte b)
                {
                    byte r = 0;
                    for (int i = 0; i < 8; i++)
                    {
                        if (((b >> i) & 1) == 1)
                            r |= (byte)(1 << (7 - i));
                    }
                    return r;
                }
                var correctionBytes = new byte[4];
                for (int i = 0; i < 4; i++)
                {
                    correctionBytes[i] = ReverseBits(correctionBytesRaw[i]);
                }

                var finalData = Concat(modData, correctionBytes);
                var finalCrc = ComputeCrc32(finalData);

                if (finalCrc == originalCrc)
                {
                    await File.WriteAllBytesAsync(targetPath, finalData);
                    log?.Invoke($"Patched CRC matched original (0x{finalCrc:X8}).");
                    return true;
                }

                log?.Invoke($"CRC patch failed. Final CRC: 0x{finalCrc:X8}, Expected: 0x{originalCrc:X8}");
                return false;
            }
            catch (Exception ex)
            {
                log?.Invoke($"CRC manipulation failed: {ex.Message}");
                return false;
            }
        }

        private static byte[] Concat(byte[] first, byte[] second)
        {
            var result = new byte[first.Length + second.Length];
            Buffer.BlockCopy(first, 0, result, 0, first.Length);
            Buffer.BlockCopy(second, 0, result, first.Length, second.Length);
            return result;
        }
    }
}
