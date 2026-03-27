import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const cwd = process.cwd();

function requiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

async function fileExists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function resolveLocalFilePath() {
    const cliArg = process.argv[2]?.trim();
    const envPath = process.env.EPS_LOCAL_FILE?.trim();
    const candidates = [
        cliArg ? path.resolve(cwd, cliArg) : null,
        envPath ? path.resolve(envPath) : null,
        path.resolve(cwd, 'data', 'sp-500-eps-est.xlsx'),
        path.resolve(cwd, 'sp-500-eps-est.xlsx'),
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (await fileExists(candidate)) {
            return candidate;
        }
    }

    throw new Error(
        `EPS workbook not found. Checked: ${candidates.join(', ')}`,
    );
}

function encodeContentPath(targetPath) {
    return targetPath
        .split('/')
        .filter(Boolean)
        .map(segment => encodeURIComponent(segment))
        .join('/');
}

async function githubRequest(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;

    if (!response.ok) {
        const message = body?.message || response.statusText;
        throw new Error(`GitHub API ${response.status}: ${message}`);
    }

    return body;
}

async function getExistingFileSha({ owner, repo, branch, targetPath, headers }) {
    const encodedPath = encodeContentPath(targetPath);
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;

    const response = await fetch(url, { headers });
    if (response.status === 404) {
        return null;
    }

    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
        const message = body?.message || response.statusText;
        throw new Error(`GitHub API ${response.status}: ${message}`);
    }

    return body?.sha ?? null;
}

async function main() {
    const token = requiredEnv('GITHUB_TOKEN');
    const owner = requiredEnv('GITHUB_OWNER');
    const repo = requiredEnv('GITHUB_REPO');
    const branch = process.env.GITHUB_BRANCH?.trim() || 'main';
    const targetPath = process.env.GITHUB_TARGET_PATH?.trim() || 'data/sp-500-eps-est.xlsx';
    const commitMessage = process.env.GITHUB_COMMIT_MESSAGE?.trim() || 'chore: update EPS workbook';
    const localFilePath = await resolveLocalFilePath();
    const content = await readFile(localFilePath);
    const encodedContent = content.toString('base64');

    const headers = {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'go_spxeps-sync-script',
        'x-github-api-version': '2022-11-28',
    };

    const sha = await getExistingFileSha({ owner, repo, branch, targetPath, headers });
    const encodedPath = encodeContentPath(targetPath);
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`;
    const payload = {
        message: commitMessage,
        content: encodedContent,
        branch,
    };

    if (sha) {
        payload.sha = sha;
    }

    const body = await githubRequest(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
    });

    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${targetPath}`;

    console.log(`Uploaded ${localFilePath}`);
    console.log(`Commit: ${body.commit?.html_url ?? '(not returned)'}`);
    console.log(`Raw URL: ${rawUrl}`);
    console.log('Use this value for EPS_SOURCE_URL if the repository is public.');
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
