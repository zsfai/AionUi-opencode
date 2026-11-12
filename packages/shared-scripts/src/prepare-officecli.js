/**
 * Vendor the pinned officecli release into resources/bundled-officecli.
 *
 * The binary is what the app runs offline. This script only talks to the
 * network when that exact version is missing. A later offline run reuses the file.
 *
 * Layout: resources/bundled-officecli/{platform}-{arch}/officecli[.exe]
 */

const fs = require('fs');
const https = require('https');
const path = require('path');
const crypto = require('crypto');

const OFFICECLI_VERSION = '1.0.161';
const GITHUB_REPO = 'iOfficeAI/OfficeCLI';

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function binaryName(platform) {
  return platform === 'win32' ? 'officecli.exe' : 'officecli';
}

function assetName(platform, arch) {
  const archName = arch === 'arm64' || arch === 'x64' ? arch : null;
  if (!archName) return null;
  if (platform === 'win32') return `officecli-win-${archName}.exe`;
  if (platform === 'darwin') return `officecli-mac-${archName}`;
  if (platform === 'linux') return `officecli-linux-${archName}`;
  return null;
}

function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    const follow = (current, redirects) => {
      if (redirects > 5) {
        reject(new Error(`Too many redirects for ${url}`));
        return;
      }
      const request = https.get(current, { headers: { 'User-Agent': 'AionUi-offline-prepare' } }, (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          follow(new URL(response.headers.location, current).toString(), redirects + 1);
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`HTTP ${status} for ${current}`));
          return;
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });
      request.setTimeout(120000, () => {
        request.destroy(new Error(`timeout downloading ${current}`));
      });
      request.on('error', reject);
    };
    follow(url, 0);
  });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function expectedSha256(sumsText, asset) {
  const lines = sumsText.split(/\r?\n/);
  for (const line of lines) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(\S+)\s*$/.exec(line.trim());
    if (match && match[2] === asset) return match[1].toLowerCase();
  }
  return null;
}

/**
 * @param {object} options
 * @param {string} options.projectRoot
 * @param {string} [options.platform]
 * @param {string} [options.arch]
 * @param {string} [options.version]
 */
function prepareOfficecli(options) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const version = (options.version || process.env.AIONUI_OFFICECLI_VERSION || OFFICECLI_VERSION).replace(/^v/, '');
  const asset = assetName(platform, arch);
  if (!asset) {
    throw new Error(`Unsupported officecli target: ${platform}-${arch}`);
  }

  const runtimeKey = `${platform}-${arch}`;
  const targetDir = path.join(options.projectRoot, 'resources', 'bundled-officecli', runtimeKey);
  const targetBinary = path.join(targetDir, binaryName(platform));
  const manifestPath = path.join(targetDir, 'manifest.json');

  if (fs.existsSync(targetBinary) && fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.version === version && manifest.asset === asset) {
        console.log(`[officecli] reusing local ${runtimeKey} v${version}`);
        return Promise.resolve({ dir: targetDir, version, reused: true });
      }
    } catch {
      // Rewrite a corrupt manifest by downloading again.
    }
  }

  const tag = `v${version}`;
  const bases = [
    `https://d.officecli.ai/releases/download/${tag}`,
    `https://github.com/${GITHUB_REPO}/releases/download/${tag}`,
  ];
  console.log(`[officecli] downloading ${asset} ${tag}`);

  const downloadFromMirrors = async (name) => {
    let lastError = null;
    for (const base of bases) {
      const url = `${base}/${name}`;
      try {
        console.log(`[officecli] GET ${url}`);
        return { buffer: await downloadUrl(url), url };
      } catch (error) {
        lastError = error;
        console.warn(`[officecli] ${url} failed: ${error.message}`);
      }
    }
    throw lastError || new Error(`Failed to download ${name}`);
  };

  return Promise.all([downloadFromMirrors(asset), downloadFromMirrors('SHA256SUMS')]).then(
    ([binaryResult, sumsResult]) => {
      const binary = binaryResult.buffer;
      const sums = sumsResult.buffer;
      const source = binaryResult.url;
      const expected = expectedSha256(sums.toString('utf8'), asset);
      const actual = sha256(binary);
      if (!expected) {
        throw new Error(`SHA256SUMS has no entry for ${asset}`);
      }
      if (expected !== actual) {
        throw new Error(`officecli checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);
      }

      ensureDirectory(targetDir);
      fs.writeFileSync(targetBinary, binary);
      if (platform !== 'win32') {
        fs.chmodSync(targetBinary, 0o755);
      }
      const manifest = {
        version,
        asset,
        binary: binaryName(platform),
        sha256: actual,
        source,
      };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      console.log(`[officecli] saved ${path.relative(options.projectRoot, targetBinary)} (${version})`);
      return { dir: targetDir, version, reused: false };
    }
  );
}

module.exports = { prepareOfficecli, OFFICECLI_VERSION, assetName, binaryName };

if (require.main === module) {
  const projectRoot = path.resolve(__dirname, '../../..');
  prepareOfficecli({
    projectRoot,
    platform: process.env.AIONUI_OFFICECLI_PLATFORM || process.platform,
    arch: process.env.AIONUI_OFFICECLI_ARCH || process.arch,
  }).catch((error) => {
    console.error('[officecli] prepare failed:', error.message);
    process.exit(1);
  });
}
