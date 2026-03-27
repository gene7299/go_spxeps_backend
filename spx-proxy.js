import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import xlsx from 'xlsx';

const PORT = Number(process.env.PORT) || 3000;
const YAHOO_ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC';
const EPS_SOURCE_URL = 'https://www.spglobal.com/spdji/en/documents/additional-material/sp-500-eps-est.xlsx';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_ROOT = path.resolve(__dirname);
const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
};

let workbookPromise;

function resolveStaticPath(pathname) {
    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const candidate = path.resolve(STATIC_ROOT, `.${requestedPath}`);
    const relativePath = path.relative(STATIC_ROOT, candidate);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return null;
    }

    return candidate;
}

async function serveStaticFile(pathname, response) {
    const filePath = resolveStaticPath(pathname);
    if (!filePath) {
        return false;
    }

    try {
        const content = await readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        response.writeHead(200, {
            'content-type': contentType,
            'cache-control': 'no-store',
        });
        response.end(content);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
            return false;
        }
        throw error;
    }
}

async function getWorkbook() {
    if (!workbookPromise) {
        workbookPromise = (async () => {
            const response = await fetch(EPS_SOURCE_URL, {
                headers: {
                    accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'user-agent': 'Mozilla/5.0 LightweightChartsDemo',
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to download EPS workbook: ${response.status}`);
            }

            const buffer = Buffer.from(await response.arrayBuffer());
            return xlsx.read(buffer, { type: 'buffer', cellDates: false });
        })();
    }

    try {
        return await workbookPromise;
    } catch (error) {
        workbookPromise = undefined;
        throw error;
    }
}

function formatDate(value) {
    // 允許 null/undefined
    if (value === null || value === undefined) {
        return null;
    }

    // Excel 數字日期 (序號)
    if (typeof value === 'number' && Number.isFinite(value)) {
        const parsed = xlsx.SSF.parse_date_code(value);
        if (!parsed || !parsed.y || !parsed.m || !parsed.d) {
            return null;
        }
        const y = parsed.y;
        const m = parsed.m;
        const d = parsed.d;
        // 用 UTC 避免時區偏移
        const dt = new Date(Date.UTC(y, m - 1, d));
        // 驗證避免像 2025-02-31 這類被自動進位
        if (
            dt.getUTCFullYear() !== y ||
            dt.getUTCMonth() + 1 !== m ||
            dt.getUTCDate() !== d
        ) {
            return null;
        }
        return [
            String(y).padStart(4, '0'),
            String(m).padStart(2, '0'),
            String(d).padStart(2, '0'),
        ].join('-');
    }

    // 若是 Date 物件
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }

    // 字串處理
    const raw = String(value).trim();
    if (!raw) return null;

    // 移除括號註記與多餘空白（例如："6/30/2025 (Prelim.)"）
    const cleaned = raw
        .replace(/\(.*?\)/g, ' ')   // 去掉括號與內容
        .replace(/\s+/g, ' ')       // 多空白壓一格
        .trim();

    if (!cleaned) return null;

    // 兩種主要格式：
    // 1) YYYY-M-D 或 YYYY/M/D 或 YYYY.M.D
    // 2) M-D-YYYY 或 M/D/YYYY 或 M.D.YYYY
    const sep = '[-/.]';
    const reYMD = new RegExp(`^(\\d{4})${sep}(\\d{1,2})${sep}(\\d{1,2})$`);
    const reMDY = new RegExp(`^(\\d{1,2})${sep}(\\d{1,2})${sep}(\\d{2,4})$`);

    let y, m, d;

    // 直接比對整串；若字串前後可能有其他文字，可改用 .match(...) 搜第一個群組
    let mYMD = cleaned.match(reYMD);
    let mMDY = cleaned.match(reMDY);

    // 若上述沒中，嘗試從字串中抓第一個日期片段（容錯：例如「Date: 9/30/2025」）
    if (!mYMD && !mMDY) {
        const findYMD = new RegExp(`(\\d{4})${sep}(\\d{1,2})${sep}(\\d{1,2})`);
        const findMDY = new RegExp(`(\\d{1,2})${sep}(\\d{1,2})${sep}(\\d{2,4})`);
        mYMD = cleaned.match(findYMD);
        mMDY = cleaned.match(findMDY);
    }

    if (mYMD) {
        y = Number(mYMD[1]);
        m = Number(mYMD[2]);
        d = Number(mYMD[3]);
    } else if (mMDY) {
        m = Number(mMDY[1]);
        d = Number(mMDY[2]);
        let yy = Number(mMDY[3]);
        // 兩位數年份處理
        if (yy < 100) {
            yy = yy <= 69 ? 2000 + yy : 1900 + yy;
        }
        y = yy;
    } else {
        // 最後一招：交給原生 Date 嘗試（不可靠，但當保底）
        const fallback = new Date(cleaned);
        if (Number.isNaN(fallback.getTime())) {
            return null;
        }
        return fallback.toISOString().slice(0, 10);
    }

    // 基本範圍驗證
    if (!(y >= 100 && y <= 9999)) return null;
    if (!(m >= 1 && m <= 12)) return null;
    if (!(d >= 1 && d <= 31)) return null;

    // 用 UTC 建立並嚴格回寫驗證，避免 2/30 這種被進位
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
        dt.getUTCFullYear() !== y ||
        dt.getUTCMonth() + 1 !== m ||
        dt.getUTCDate() !== d
    ) {
        return null;
    }

    const yyyy = String(y).padStart(4, '0');
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}


function collectPointsAsReportedEarnings(sheet, startRow, endRowExclusive) {
    const points = [];
    let encounteredData = false;

    for (let row = startRow; row < endRowExclusive; row += 1) {
        const dateCell = sheet[xlsx.utils.encode_cell({ c: 0, r: row })];
        const valueCell = sheet[xlsx.utils.encode_cell({ c: 9, r: row })];

        const rawDate = dateCell?.v;
        const labelUpper = typeof rawDate === 'string' ? rawDate.trim().toUpperCase() : null;
        if (labelUpper === 'ACTUALS' || labelUpper === 'ESTIMATES') {
            continue;
        }

        const formattedDate = formatDate(rawDate);
        if (!formattedDate) {
            if (encounteredData) {
                break;
            }
            continue;
        }

        encounteredData = true;
        const numericValue = Number(valueCell?.v);
        if (!Number.isFinite(numericValue)) {
            continue;
        }

        points.push({ time: formattedDate, value: numericValue });
    }

    return points;
}
function collectPointsOperatingEarnings(sheet, startRow, endRowExclusive) {
    const points = [];
    let encounteredData = false;

    for (let row = startRow; row < endRowExclusive; row += 1) {
        const dateCell = sheet[xlsx.utils.encode_cell({ c: 0, r: row })];
        const valueCell = sheet[xlsx.utils.encode_cell({ c: 8, r: row })];

        const rawDate = dateCell?.v;
        const labelUpper = typeof rawDate === 'string' ? rawDate.trim().toUpperCase() : null;
        if (labelUpper === 'ACTUALS' || labelUpper === 'ESTIMATES') {
            continue;
        }

        const formattedDate = formatDate(rawDate);
        if (!formattedDate) {
            if (encounteredData) {
                break;
            }
            continue;
        }

        encounteredData = true;
        const numericValue = Number(valueCell?.v);
        if (!Number.isFinite(numericValue)) {
            continue;
        }

        points.push({ time: formattedDate, value: numericValue });
    }

    return points;
}
async function loadEpsDataforAsReported() {
    try {
        const workbook = await getWorkbook();
        const sheet = workbook.Sheets['ESTIMATES&PEs'];
        if (!sheet) {
            console.warn('Sheet ESTIMATES&PEs not found in EPS workbook.');
            return { actuals: [], estimates: [] };
        }

        const range = xlsx.utils.decode_range(sheet['!ref']);
        let estimatesStartRow = null;
        let actualsStartRow = null;
        let actualsLabelRow = range.e.r + 1;

        for (let row = range.s.r; row <= range.e.r; row += 1) {
            const cell = sheet[xlsx.utils.encode_cell({ c: 0, r: row })];
            if (!cell || cell.v == null) {
                continue;
            }

            const label = String(cell.v).trim().toUpperCase();
            if (label === 'ESTIMATES' && estimatesStartRow === null) {
                estimatesStartRow = row + 1;
                continue;
            }

            if (label === 'ACTUALS') {
                actualsLabelRow = row;
                actualsStartRow = row + 1;
                break;
            }
        }

        const estimates = estimatesStartRow !== null
            ? collectPointsAsReportedEarnings(sheet, estimatesStartRow, actualsLabelRow)
            : [];
        const actuals = actualsStartRow !== null
            ? collectPointsAsReportedEarnings(sheet, actualsStartRow, range.e.r + 1)
            : [];

        estimates.sort((a, b) => (a.time > b.time ? 1 : -1));
        actuals.sort((a, b) => (a.time > b.time ? 1 : -1));
        // 確保估值線段至少延伸到最新實績日期
        if (estimates.length > 0 && actuals.length > 0) {
            const firstEst = estimates[0];
            const lastAct = actuals[actuals.length - 1];
            console.log('First estimate date:', firstEst.time, 'Last actual date:', lastAct.time);
            if (firstEst.time > lastAct.time) {
                //add new point at the first of estimates 
                estimates.unshift({ time: lastAct.time, value: lastAct.value });
            } 
        }
        return { actuals, estimates };
    } catch (error) {
        console.error('Failed to load EPS data from Excel', error);
        return { actuals: [], estimates: [] };
    }
}
async function loadEpsDataForOperating() {
    try {
        const workbook = await getWorkbook();
        const sheet = workbook.Sheets['ESTIMATES&PEs'];
        if (!sheet) {
            console.warn('Sheet ESTIMATES&PEs not found in EPS workbook.');
            return { actuals: [], estimates: [] };
        }

        const range = xlsx.utils.decode_range(sheet['!ref']);
        let estimatesStartRow = null;
        let actualsStartRow = null;
        let actualsLabelRow = range.e.r + 1;

        for (let row = range.s.r; row <= range.e.r; row += 1) {
            const cell = sheet[xlsx.utils.encode_cell({ c: 0, r: row })];
            if (!cell || cell.v == null) {
                continue;
            }

            const label = String(cell.v).trim().toUpperCase();
            if (label === 'ESTIMATES' && estimatesStartRow === null) {
                estimatesStartRow = row + 1;
                continue;
            }

            if (label === 'ACTUALS') {
                actualsLabelRow = row;
                actualsStartRow = row + 1;
                break;
            }
        }

        const estimates = estimatesStartRow !== null
            ? collectPointsOperatingEarnings(sheet, estimatesStartRow, actualsLabelRow)
            : [];
        const actuals = actualsStartRow !== null
            ? collectPointsOperatingEarnings(sheet, actualsStartRow, range.e.r + 1)
            : [];

        estimates.sort((a, b) => (a.time > b.time ? 1 : -1));
        actuals.sort((a, b) => (a.time > b.time ? 1 : -1));
        // 確保估值線段至少延伸到最新實績日期
        if (estimates.length > 0 && actuals.length > 0) {
            const firstEst = estimates[0];
            const lastAct = actuals[actuals.length - 1];
            console.log('First estimate date:', firstEst.time, 'Last actual date:', lastAct.time);
            if (firstEst.time > lastAct.time) {
                //add new point at the first of estimates 
                estimates.unshift({ time: lastAct.time, value: lastAct.value });
            } 
        }
        return { actuals, estimates };
    } catch (error) {
        console.error('Failed to load EPS data from Excel', error);
        return { actuals: [], estimates: [] };
    }
}
async function fetchFromYahoo(range, interval) {
    const upstreamUrl = new URL(YAHOO_ENDPOINT);
    upstreamUrl.searchParams.set('range', range);
    upstreamUrl.searchParams.set('interval', interval);

    const response = await fetch(upstreamUrl, {
        headers: {
            accept: 'application/json',
            'user-agent': 'Mozilla/5.0 LightweightChartsDemo',
        },
    });

    if (!response.ok) {
        throw new Error(`Yahoo Finance responded with ${response.status}`);
    }

    const payload = await response.json();
    const result = payload?.chart?.result?.[0];

    if (!result) {
        throw new Error('Unexpected response structure from Yahoo Finance');
    }

    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    const quote = Array.isArray(result.indicators?.quote) ? result.indicators.quote[0] ?? {} : {};
    const opens = Array.isArray(quote.open) ? quote.open : [];
    const highs = Array.isArray(quote.high) ? quote.high : [];
    const lows = Array.isArray(quote.low) ? quote.low : [];
    const closes = Array.isArray(quote.close) ? quote.close : [];

    const areaData = [];
    const candlestickData = [];

    for (let index = 0; index < timestamps.length; index += 1) {
        const time = timestamps[index];
        const open = opens[index];
        const high = highs[index];
        const low = lows[index];
        const close = closes[index];

        if (Number.isFinite(close)) {
            areaData.push({ time, value: close });
        }

        if ([open, high, low, close].every(Number.isFinite)) {
            candlestickData.push({ time, open, high, low, close });
        }
    }

    return { areaData, candlestickData };
}

const server = http.createServer(async (request, response) => {
    try {
        const requestUrl = new URL(request.url, `http://${request.headers.host}`);

        if (requestUrl.pathname === '/api/spx' && request.method === 'GET') {
            const range = requestUrl.searchParams.get('range') || '10y';
            const interval = requestUrl.searchParams.get('interval') || '1d';

            const priceData = await fetchFromYahoo(range, interval);
            const [epsData, epsDataForOperating] = await Promise.all([
                loadEpsDataforAsReported(),
                loadEpsDataForOperating(),
            ]);

            const responseBody = {
                ...priceData,
                epsActuals: epsData.actuals,
                epsEstimates: epsData.estimates,
                epsActualsForOperating: epsDataForOperating.actuals,
                epsEstimatesForOperating: epsDataForOperating.estimates
            };

            response.writeHead(200, {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
                'access-control-allow-origin': '*',
            });
            response.end(JSON.stringify(responseBody));
            return;
        }

        if (request.method === 'GET' && await serveStaticFile(requestUrl.pathname, response)) {
            return;
        }

        if (request.method === 'OPTIONS') {
            response.writeHead(204, {
                allow: 'GET,OPTIONS',
                'access-control-allow-origin': '*',
                'access-control-allow-methods': 'GET,OPTIONS',
            });
            response.end();
            return;
        }

        response.writeHead(404, {
            'content-type': 'application/json; charset=utf-8',
            'access-control-allow-origin': '*',
        });
        response.end(JSON.stringify({ error: 'Not found' }));
    } catch (error) {
        console.error(error);
        response.writeHead(502, {
            'content-type': 'application/json; charset=utf-8',
            'access-control-allow-origin': '*',
        });
        response.end(JSON.stringify({ error: error.message }));
    }
});

server.listen(PORT, () => {
    console.log(`SPX app server is running on http://localhost:${PORT}`);
});
