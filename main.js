// ===== Lightweight Charts =====
import { CandlestickSeries, LineSeries, LineStyle, LineType, createChart } from './dist/lightweight-charts.standalone.production.mjs';

// ===== Chart 基本設定 =====
const container = document.getElementById('container');
const chart = createChart(container, {
    autoSize: true,
    layout: { textColor: 'white', background: { type: 'solid', color: 'black' } },
    grid: {
        vertLines: { visible: true, color: '#444' },
        horzLines: { visible: true, color: '#444' },
    },
    rightPriceScale: {
        borderVisible: true,
    },
    timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderVisible: true,
    },
});

// K 線
const candlestickSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#26a69a',
    downColor: '#ef5350',
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350',
    borderVisible: false,
});

// 內在價值（實際 EPS 計算）
const intrinsicSeries = chart.addSeries(LineSeries, {
    color: '#4caf50',
    lineWidth: 2,
    lineType: LineType.WithSteps,
    pointMarkersVisible: true,
});

// 內在價值（預估 EPS 計算）
const epsEstimatesSeries = chart.addSeries(LineSeries, {
    color: '#4caf50',
    lineWidth: 2,
    lineType: LineType.WithSteps,
    lineStyle: LineStyle.Dashed,
    pointMarkersVisible: true,
});

// 內在價值（實際 EPS 計算）
const intrinsicSeriesForOperating = chart.addSeries(LineSeries, {
    color: 'rgba(255, 177, 8, 1)',
    lineWidth: 2,
    lineType: LineType.WithSteps,
    pointMarkersVisible: true,
});

// 內在價值（預估 EPS 計算）
const epsEstimatesSeriesForOperating = chart.addSeries(LineSeries, {
    color: 'rgba(255, 177, 8, 1)',
    lineWidth: 2,
    lineType: LineType.WithSteps,
    lineStyle: LineStyle.Dashed,
    pointMarkersVisible: true,
});


// ===== Graham 參數與內在價值換算 =====
const GRAHAM_PARAMS_UPGRADE = {
    basePE: 8.5,
    base2g: 2.0,
    noRiskYield: 4.4,
    aaaYield: 5.0,
    rate3: 10,
};

const GRAHAM_PARAMS_CONSERVE = {
    basePE: 7.5,
    base2g: 1.5,
    noRiskYield: 4.4,
    aaaYield: 4.5,
    rate3: 10,
};

let GRAHAM_PARAMS = GRAHAM_PARAMS_UPGRADE;
const GRAHAM_PARAM_SETS = {
    upgrade: GRAHAM_PARAMS_UPGRADE,
    conserve: GRAHAM_PARAMS_CONSERVE,
};

let grahamParamsMode = 'upgrade';
let grahamToggleButton;
let grahamModeDisplay;

const GROWTH_RATE_INPUT_ID = 'growth-rate-control';

let epsActualsBase = [];
let epsEstimatesBase = [];
let epsActualsForOperatingBase = [];
let epsEstimatesForOperatingBase = [];
let growthRateDisplay;
let growthRateInput;

function computeGrahamMultiplier(rate) {
    return ((GRAHAM_PARAMS.basePE + GRAHAM_PARAMS.base2g * rate) * GRAHAM_PARAMS.noRiskYield) / GRAHAM_PARAMS.aaaYield;
}

// 將 EPS 點位換成內在價值線（先不改 time 型別，統一在後面做）
function buildIntrinsicData(points = [], multiplier = 1) {
    const intrinsic = [];
    const ratio = Number.isFinite(multiplier) ? multiplier : 1;
    for (const p of points || []) {
        const v = Number(p?.value);
        if (!Number.isFinite(v)) continue;
        intrinsic.push({ time: p.time, value: v * ratio });
    }
    return intrinsic;
}

function updateIntrinsicSeries() {
    const multiplier = computeGrahamMultiplier(GRAHAM_PARAMS.rate3);
    if (Array.isArray(epsActualsBase) && epsActualsBase.length > 0) {
        intrinsicSeries.setData(normalizeSeriesTimeUnix(buildIntrinsicData(epsActualsBase, multiplier)));
    }
    if (Array.isArray(epsEstimatesBase) && epsEstimatesBase.length > 0) {
        epsEstimatesSeries.setData(normalizeSeriesTimeUnix(buildIntrinsicData(epsEstimatesBase, multiplier)));
    }
    if (Array.isArray(epsActualsForOperatingBase) && epsActualsForOperatingBase.length > 0) {
        intrinsicSeriesForOperating.setData(normalizeSeriesTimeUnix(buildIntrinsicData(epsActualsForOperatingBase, multiplier)));
    }
    if (Array.isArray(epsEstimatesForOperatingBase) && epsEstimatesForOperatingBase.length > 0) {
        epsEstimatesSeriesForOperating.setData(normalizeSeriesTimeUnix(buildIntrinsicData(epsEstimatesForOperatingBase, multiplier)));
    }
}

function formatGrahamMode(mode) {
    return mode === 'upgrade' ? '升級' : '保守';
}

function updateGrahamModeUI() {
    if (grahamModeDisplay) {
        grahamModeDisplay.textContent = `Graham 模式：${formatGrahamMode(grahamParamsMode)}`;
    }
    if (grahamToggleButton) {
        const nextMode = grahamParamsMode === 'upgrade' ? 'conserve' : 'upgrade';
        grahamToggleButton.textContent = `切換至${formatGrahamMode(nextMode)}參數`;
    }
}

function setGrahamParamsMode(mode) {
    if (!(mode in GRAHAM_PARAM_SETS)) {
        return;
    }
    grahamParamsMode = mode;
    GRAHAM_PARAMS = GRAHAM_PARAM_SETS[mode];
    setGrowthRate(GRAHAM_PARAMS.rate3);
    updateGrahamModeUI();
}

function setGrowthRate(value) {
    if (!Number.isFinite(value)) {
        return;
    }
    GRAHAM_PARAMS.rate3 = value;
    if (growthRateDisplay) {
        growthRateDisplay.textContent = value.toFixed(1);
    }
    if (growthRateInput && Number(growthRateInput.value) !== value) {
        growthRateInput.value = String(value);
    }
    updateIntrinsicSeries();
}

function attachGrowthRateControl() {
    if (!container) {
        return;
    }

    if (!['relative', 'absolute', 'fixed'].includes(container.style.position)) {
        container.style.position = 'relative';
    }

    const control = document.createElement('div');
    control.style.position = 'absolute';
    control.style.top = '16px';
    control.style.left = '16px';
    control.style.padding = '8px 12px';
    control.style.borderRadius = '6px';
    control.style.background = 'rgba(0, 0, 0, 0.7)';
    control.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.25)';
    control.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    control.style.color = '#f5f5f5';
    control.style.minWidth = '200px';
    control.style.zIndex = '10';

    const headerRow = document.createElement('div');
    headerRow.style.display = 'flex';
    headerRow.style.alignItems = 'center';
    headerRow.style.justifyContent = 'space-between';
    headerRow.style.gap = '12px';
    headerRow.style.marginBottom = '8px';

    const label = document.createElement('label');
    label.htmlFor = GROWTH_RATE_INPUT_ID;
    label.textContent = 'GrowthRate';
    label.style.display = 'block';
    label.style.fontSize = '12px';
    label.style.fontWeight = '600';
    label.style.marginBottom = '0';

    const modeRow = document.createElement('div');
    modeRow.style.display = 'flex';
    modeRow.style.alignItems = 'center';
    modeRow.style.gap = '8px';

    const modeStatus = document.createElement('span');
    modeStatus.style.fontSize = '12px';
    modeStatus.style.opacity = '0.85';

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.style.border = 'none';
    toggleButton.style.borderRadius = '4px';
    toggleButton.style.padding = '4px 8px';
    toggleButton.style.fontSize = '12px';
    toggleButton.style.fontWeight = '600';
    toggleButton.style.background = '#1976d2';
    toggleButton.style.color = '#fff';
    toggleButton.style.cursor = 'pointer';
    toggleButton.style.whiteSpace = 'nowrap';
    toggleButton.addEventListener('click', () => {
        const nextMode = grahamParamsMode === 'upgrade' ? 'conserve' : 'upgrade';
        setGrahamParamsMode(nextMode);
    });

    grahamModeDisplay = modeStatus;
    grahamToggleButton = toggleButton;
    updateGrahamModeUI();

    modeRow.append(modeStatus, toggleButton);
    headerRow.append(label, modeRow);

    const valueRow = document.createElement('div');
    valueRow.style.display = 'flex';
    valueRow.style.alignItems = 'center';
    valueRow.style.gap = '8px';

    const input = document.createElement('input');
    input.type = 'range';
    input.id = GROWTH_RATE_INPUT_ID;
    input.min = '0';
    input.max = '20';
    input.step = '0.1';
    input.value = String(GRAHAM_PARAMS.rate3);
    input.style.flex = '1';

    const value = document.createElement('span');
    value.style.minWidth = '48px';
    value.style.textAlign = 'right';
    value.textContent = GRAHAM_PARAMS.rate3.toFixed(1);

    growthRateInput = input;
    growthRateDisplay = value;

    input.addEventListener('input', () => {
        setGrowthRate(Number(input.value));
    });

    valueRow.append(input, value);
    control.append(headerRow, valueRow);
    container.appendChild(control);
}

attachGrowthRateControl();

// ===== 時間工具：把所有 series 的時間統一為「UNIX 秒（UTC）」 =====
const ONE_DAY = 24 * 60 * 60;
const ONE_WEEK = 7 * ONE_DAY;

function toUnixSecUTC(t) {
    // 若已是 unix 秒
    if (typeof t === 'number' && Number.isFinite(t)) return t;

    // 若是 'YYYY-MM-DD' 之類字串
    if (typeof t === 'string') {
        const ms = Date.parse(t + 'T00:00:00Z'); // 用 UTC，避免時區位移
        return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
    }
    return NaN;
}

function normalizeSeriesTimeUnix(points) {
    const out = [];
    for (const p of points || []) {
        const ts = toUnixSecUTC(p.time);
        const v = Number(p.value);
        if (!Number.isFinite(ts) || !Number.isFinite(v)) continue;
        out.push({ time: ts, value: v });
    }
    out.sort((a, b) => a.time - b.time);
    return out;
}

function getMinMaxUnixSec(points) {
    let min = Infinity, max = -Infinity;
    for (const p of points || []) {
        const ts = toUnixSecUTC(p.time);
        if (!Number.isFinite(ts)) continue;
        if (ts < min) min = ts;
        if (ts > max) max = ts;
    }
    return { min, max };
}

function getCandlesMinMaxUnixSec(candles) {
    let min = Infinity, max = -Infinity;
    for (const c of candles || []) {
        const ts = toUnixSecUTC(c.time);
        if (!Number.isFinite(ts)) continue;
        if (ts < min) min = ts;
        if (ts > max) max = ts;
    }
    return { min, max };
}

// 依 interval 取得網格步階（僅示範 1d / 1wk；其餘可再擴充）
function stepSecondsFromInterval(interval) {
    const iv = String(interval || '').toLowerCase();
    if (iv === '1wk' || iv === '1w') return ONE_WEEK;
    return ONE_DAY; // 預設用日
}

// 產生等距時間網格（含頭尾）
function buildGridTimes(fromSec, toSec, stepSec) {
    if (!Number.isFinite(fromSec) || !Number.isFinite(toSec) || !(stepSec > 0)) return [];
    const start = fromSec;
    const end = toSec;
    const out = [];
    for (let t = start; t <= end; t += stepSec) out.push(t);
    if (out.length === 0 || out[out.length - 1] !== end) out.push(end);
    return out;
}

// 用「whitespace bars」把 K 線補滿網格（不破壞既有 OHLC）
function extendCandlesWithWhitespace(candles, gridTimes) {
    const have = new Set((candles || []).map(c => toUnixSecUTC(c.time)));
    const extended = (candles || []).map(c => ({ ...c, time: toUnixSecUTC(c.time) }));

    for (const ts of gridTimes) {
        if (!have.has(ts)) {
            // 對 CandlestickSeries，whitespace 只要 time
            extended.push({ time: ts });
        }
    }
    extended.sort((a, b) => a.time - b.time);
    return extended;
}

// ===== 取資料 =====
const SPX_PROXY_ENDPOINT = '/api/spx';

async function fetchSpxData(range = '35y', interval = '1d') {
    const url = new URL(SPX_PROXY_ENDPOINT, window.location.href);
    url.searchParams.set('range', range);
    url.searchParams.set('interval', interval);

    const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`SPX proxy responded with ${res.status}`);
    return res.json();
}

// ===== 主流程：建立「全域網格」→ 補 K 線 whitespace → 畫三條線 =====
(async () => {
    try {
        // 你目前取的是 35y / 1wk，若改 1d，演算法也適用（把步階改為日）
        const chosenRange = '35y';
        const chosenInterval = '1wk';

        const { candlestickData, epsActuals, epsEstimates, epsActualsForOperating, epsEstimatesForOperating} = await fetchSpxData(chosenRange, chosenInterval);

        epsActualsBase = Array.isArray(epsActuals) ? epsActuals : [];
        epsEstimatesBase = Array.isArray(epsEstimates) ? epsEstimates : [];
        epsActualsForOperatingBase = Array.isArray(epsActualsForOperating) ? epsActualsForOperating : [];
        epsEstimatesForOperatingBase = Array.isArray(epsEstimatesForOperating) ? epsEstimatesForOperating : [];


        const multiplier = computeGrahamMultiplier(GRAHAM_PARAMS.rate3);

        // 1) 先把 intrinsic 系列算出來（仍保留原 time 型別，待會統一轉換）
        const intrinsicActuals = buildIntrinsicData(epsActualsBase, multiplier);
        const intrinsicEst = buildIntrinsicData(epsEstimatesBase, multiplier);
        const intrinsicActualsForOperating = buildIntrinsicData(epsActualsForOperatingBase, multiplier);
        const intrinsicEstForOperating = buildIntrinsicData(epsEstimatesForOperatingBase, multiplier);

        // 2) 取得三個系列（K 線、兩條 intrinsic）的全域時間邊界（用 unix 秒）
        const { min: cMin, max: cMax } = getCandlesMinMaxUnixSec(candlestickData);
        const { min: aMin, max: aMax } = getMinMaxUnixSec(intrinsicActuals);
        const { min: eMin, max: eMax } = getMinMaxUnixSec(intrinsicEst);

        const globalMin = Math.min(
            Number.isFinite(cMin) ? cMin : Infinity,
            Number.isFinite(aMin) ? aMin : Infinity,
            Number.isFinite(eMin) ? eMin : Infinity,
        );
        const globalMax = Math.max(
            Number.isFinite(cMax) ? cMax : -Infinity,
            Number.isFinite(aMax) ? aMax : -Infinity,
            Number.isFinite(eMax) ? eMax : -Infinity,
        );

        if (!Number.isFinite(globalMin) || !Number.isFinite(globalMax)) {
            throw new Error('No valid time range from incoming data.');
        }

        // 3) 依 interval 產生固定步階的「全域網格」
        const stepSec = stepSecondsFromInterval(chosenInterval);
        const gridTimes = buildGridTimes(globalMin, globalMax, stepSec);

        // 4) 用 whitespace bars 把 K 線補滿至「全域網格」
        const candlesExtended = extendCandlesWithWhitespace(candlestickData, gridTimes);

        // 5) 統一把 intrinsic 兩條都轉為 unix 秒並排序
        const intrinsicActualsUnix = normalizeSeriesTimeUnix(intrinsicActuals);
        const intrinsicEstUnix = normalizeSeriesTimeUnix(intrinsicEst);
        const intrinsicActualsForOperatingUnix = normalizeSeriesTimeUnix(intrinsicActualsForOperating);
        const intrinsicEstForOperatingUnix = normalizeSeriesTimeUnix(intrinsicEstForOperating);

        // 6) 寫回圖表
        candlestickSeries.setData(candlesExtended);
        intrinsicSeries.setData(intrinsicActualsUnix);
        epsEstimatesSeries.setData(intrinsicEstUnix);
        intrinsicSeriesForOperating.setData(intrinsicActualsForOperatingUnix);
        epsEstimatesSeriesForOperating.setData(intrinsicEstForOperatingUnix);


        // 7) 一開始就把視窗打開到「全域時間」，確保 K 線外側的 intrinsic 也照同一刻度展示
        chart.timeScale().setVisibleRange({ from: globalMin, to: globalMax });

        // ※ 重要：不要再用 setVisibleLogicalRange 去+0.5/-0.5，
        //   那會重新壓縮視窗，造成你之前看到的「擠壓錯覺」。
    } catch (err) {
        console.error('Failed to load SPX data', err);
    }
})();
