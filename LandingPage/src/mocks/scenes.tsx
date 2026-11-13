import { useId } from 'react';

type Tower = readonly [x: number, width: number, top: number];
type Light = readonly [x: number, y: number, size: number, opacity: number];
type Window = readonly [x: number, y: number, warm: boolean, opacity: number];

/** Deterministic pseudo-random numbers, so every render draws the same picture. */
function sequence(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

function skyline(towers: readonly Tower[], ground: number): string {
    return towers
        .map(([x, width, top]) => `M${x} ${ground}V${top}h${width}V${ground}z`)
        .join('');
}

function scatter(
    count: number,
    seed: number,
    area: { x: number; y: number; width: number; height: number },
    size: readonly [number, number]
): Light[] {
    const next = sequence(seed);
    return Array.from({ length: count }, () => [
        area.x + next() * area.width,
        area.y + next() * area.height,
        size[0] + next() * (size[1] - size[0]),
        0.3 + next() * 0.65,
    ]);
}

function litWindows(
    towers: readonly Tower[],
    bottom: number,
    seed: number,
    litShare: number
): Window[] {
    const next = sequence(seed);
    const lit: Window[] = [];
    for (const [x, width, top] of towers) {
        for (let wy = top + 14; wy < bottom; wy += 17) {
            for (let wx = x + 9; wx + 5 < x + width - 6; wx += 13) {
                if (next() < litShare) {
                    lit.push([wx, wy, next() < 0.78, 0.55 + next() * 0.45]);
                }
            }
        }
    }
    return lit;
}

const CITY_FAR: readonly Tower[] = [
    [0, 60, 270],
    [54, 52, 286],
    [100, 70, 248],
    [166, 44, 274],
    [206, 36, 258],
    [238, 92, 292],
    [326, 58, 264],
    [380, 84, 254],
    [460, 74, 296],
    [530, 72, 270],
    [598, 82, 302],
    [676, 50, 266],
    [722, 60, 242],
    [778, 58, 288],
    [832, 70, 302],
    [898, 66, 276],
    [960, 80, 294],
];

const CITY_NEAR: readonly Tower[] = [
    [0, 72, 394],
    [64, 90, 356],
    [148, 62, 382],
    [204, 86, 316],
    [284, 58, 372],
    [336, 94, 344],
    [424, 56, 390],
    [472, 106, 316],
    [572, 64, 378],
    [630, 78, 350],
    [702, 60, 398],
    [756, 72, 298],
    [822, 54, 364],
    [870, 80, 342],
    [944, 96, 374],
];

const CITY_SPIRES = [
    [186, 118, 256],
    [655, 118, 272],
] as const;

const CITY_BOKEH = [
    [14, 492, 13, '#f0a93b', 0.45],
    [105, 512, 12, '#5b86c8', 0.4],
    [113, 476, 12, '#f0a93b', 0.5],
    [152, 524, 16, '#5b86c8', 0.35],
    [226, 532, 18, '#f0a93b', 0.4],
    [305, 512, 9, '#5b86c8', 0.4],
    [377, 563, 16, '#f0a93b', 0.3],
    [404, 503, 18, '#f0a93b', 0.45],
    [441, 497, 12, '#5b86c8', 0.4],
    [474, 572, 9, '#f0a93b', 0.35],
    [586, 486, 12, '#f0a93b', 0.5],
    [636, 524, 10, '#5b86c8', 0.45],
    [659, 496, 14, '#f0a93b', 0.45],
    [668, 552, 14, '#5b86c8', 0.35],
    [706, 502, 16, '#ffd58a', 0.35],
    [884, 472, 12, '#ffd58a', 0.45],
    [930, 468, 11, '#f0a93b', 0.4],
    [998, 500, 9, '#f0a93b', 0.45],
] as const;

const CITY_STARS = scatter(
    70,
    7,
    { x: 0, y: 8, width: 1040, height: 240 },
    [0.6, 1.5]
);
const CITY_NEAR_WINDOWS = litWindows(CITY_NEAR, 500, 11, 0.18);
const CITY_FAR_WINDOWS = litWindows(CITY_FAR, 330, 23, 0.12);

/** A city at night under a full moon. */
export function NightCityScene() {
    const id = useId();
    const sky = `${id}sky`;
    const moonGlow = `${id}glow`;
    const moon = `${id}moon`;
    const soften = `${id}soften`;
    const scrim = `${id}scrim`;
    return (
        <svg
            className="scene"
            viewBox="0 0 1040 585"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
        >
            <defs>
                <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#04060d" />
                    <stop offset="0.15" stopColor="#081125" />
                    <stop offset="0.3" stopColor="#0d1937" />
                    <stop offset="0.37" stopColor="#121f3f" />
                    <stop offset="0.42" stopColor="#262b46" />
                    <stop offset="0.48" stopColor="#3b3446" />
                </linearGradient>
                <radialGradient id={moonGlow}>
                    <stop offset="0" stopColor="#cfc6ae" stopOpacity="0.3" />
                    <stop offset="1" stopColor="#cfc6ae" stopOpacity="0" />
                </radialGradient>
                <radialGradient id={moon} cx="0.42" cy="0.4">
                    <stop offset="0" stopColor="#fbf3dc" />
                    <stop offset="1" stopColor="#e2d3ad" />
                </radialGradient>
                <filter
                    id={soften}
                    x="-50%"
                    y="-50%"
                    width="200%"
                    height="200%"
                >
                    <feGaussianBlur stdDeviation="4" />
                </filter>
                <linearGradient id={scrim} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0.6" stopColor="#020407" stopOpacity="0" />
                    <stop offset="1" stopColor="#020407" stopOpacity="0.95" />
                </linearGradient>
            </defs>
            <rect width="1040" height="585" fill={`url(#${sky})`} />
            {CITY_STARS.map(([x, y, r, opacity], index) => (
                <circle
                    key={index}
                    cx={x}
                    cy={y}
                    r={r}
                    fill="#fff"
                    opacity={opacity}
                />
            ))}
            <circle cx="832" cy="106" r="160" fill={`url(#${moonGlow})`} />
            <circle cx="832" cy="106" r="23" fill={`url(#${moon})`} />
            {CITY_SPIRES.map(([x, top, base]) => (
                <g key={x}>
                    <path
                        d={`M${x - 8} ${base}L${x} ${top + 8}L${x + 8} ${base}z`}
                        fill="#26306a"
                    />
                    <path
                        d={`M${x} ${top}V${top + 12}`}
                        stroke="#26306a"
                        strokeWidth="1.5"
                    />
                    <circle
                        cx={x}
                        cy={top}
                        r="6"
                        fill="#ff5a4f"
                        opacity="0.25"
                    />
                    <circle cx={x} cy={top} r="2" fill="#ff5a4f" />
                </g>
            ))}
            <path d={skyline(CITY_FAR, 585)} fill="#1b2750" />
            {CITY_FAR_WINDOWS.map(([x, y, , opacity], index) => (
                <rect
                    key={index}
                    x={x}
                    y={y}
                    width="5"
                    height="7"
                    fill="#f5b83d"
                    opacity={opacity * 0.5}
                />
            ))}
            <path d={skyline(CITY_NEAR, 585)} fill="#0f1935" />
            {CITY_NEAR_WINDOWS.map(([x, y, warm, opacity], index) => (
                <rect
                    key={index}
                    x={x}
                    y={y}
                    width="5"
                    height="7"
                    fill={warm ? '#f5b83d' : '#a9c8ff'}
                    opacity={opacity}
                />
            ))}
            <g filter={`url(#${soften})`}>
                {CITY_BOKEH.map(([x, y, r, color, opacity], index) => (
                    <circle
                        key={index}
                        cx={x}
                        cy={y}
                        r={r}
                        fill={color}
                        opacity={opacity}
                    />
                ))}
            </g>
            <rect width="1040" height="585" fill={`url(#${scrim})`} />
        </svg>
    );
}

const SUN_REFLECTION = [
    [142, 46, 0.85],
    [150, 34, 0.7],
    [158, 30, 0.55],
    [168, 24, 0.45],
    [180, 20, 0.35],
    [194, 16, 0.25],
] as const;

/** Sundown over the water, the backdrop for the subtitle layout previews. */
export function SunsetScene() {
    const id = useId();
    const sky = `${id}sky`;
    const glow = `${id}glow`;
    const sun = `${id}sun`;
    const water = `${id}water`;
    const soften = `${id}soften`;
    return (
        <svg
            className="scene"
            viewBox="0 0 380 212"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
        >
            <defs>
                <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#0e1328" />
                    <stop offset="0.18" stopColor="#212042" />
                    <stop offset="0.36" stopColor="#3d3262" />
                    <stop offset="0.5" stopColor="#6c456b" />
                    <stop offset="0.66" stopColor="#a85c70" />
                    <stop offset="0.8" stopColor="#d07f65" />
                    <stop offset="0.95" stopColor="#f29f5d" />
                </linearGradient>
                <radialGradient id={glow}>
                    <stop offset="0" stopColor="#ffb862" stopOpacity="0.6" />
                    <stop offset="1" stopColor="#ffb862" stopOpacity="0" />
                </radialGradient>
                <linearGradient id={sun} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#fff0b8" />
                    <stop offset="1" stopColor="#ffc35e" />
                </linearGradient>
                <linearGradient id={water} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#4a3a61" />
                    <stop offset="0.15" stopColor="#2f2649" />
                    <stop offset="0.45" stopColor="#1c1833" />
                    <stop offset="0.8" stopColor="#0e0e1e" />
                    <stop offset="1" stopColor="#080914" />
                </linearGradient>
                <filter
                    id={soften}
                    x="-20%"
                    y="-200%"
                    width="140%"
                    height="500%"
                >
                    <feGaussianBlur stdDeviation="1.6" />
                </filter>
            </defs>
            <rect width="380" height="134" fill={`url(#${sky})`} />
            <circle cx="190" cy="126" r="110" fill={`url(#${glow})`} />
            <g filter={`url(#${soften})`} fill="#f6c6b2">
                <ellipse cx="318" cy="46" rx="52" ry="2.4" opacity="0.55" />
                <ellipse cx="96" cy="86" rx="64" ry="1.8" opacity="0.3" />
                <ellipse cx="268" cy="98" rx="74" ry="2" opacity="0.35" />
            </g>
            <circle cx="190" cy="128" r="21" fill={`url(#${sun})`} />
            <path
                d="M0 112C34 102 70 100 108 106c30 5 48 16 74 22v8H0z"
                fill="#2a2248"
            />
            <path
                d="M200 128c30-8 64-26 106-28 30-1 52 5 74 10v26H200z"
                fill="#231d40"
            />
            <rect y="132" width="380" height="80" fill={`url(#${water})`} />
            {SUN_REFLECTION.map(([y, width, opacity]) => (
                <rect
                    key={y}
                    x={190 - width / 2}
                    y={y}
                    width={width}
                    height="1.6"
                    rx="0.8"
                    fill="#e9b46f"
                    opacity={opacity}
                />
            ))}
        </svg>
    );
}

const STAGE_DUST = scatter(
    34,
    5,
    { x: 330, y: 110, width: 180, height: 300 },
    [0.7, 1.5]
).filter(([x, y]) => Math.abs(x - 420) < 40 + (y - 96) * 0.4);

/** A theater stage under a spotlight, letterboxed inside the player. */
export function StageScene() {
    const id = useId();
    const wall = `${id}wall`;
    const folds = `${id}folds`;
    const shadeLeft = `${id}shadeLeft`;
    const shadeRight = `${id}shadeRight`;
    const valance = `${id}valance`;
    const beam = `${id}beam`;
    const pool = `${id}pool`;
    const soften = `${id}soften`;
    return (
        <svg
            className="scene"
            viewBox="0 0 840 560"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
        >
            <defs>
                <linearGradient id={wall} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#0d1333" />
                    <stop offset="0.5" stopColor="#070a18" />
                    <stop offset="1" stopColor="#04060c" />
                </linearGradient>
                <linearGradient
                    id={folds}
                    x1="0"
                    x2="26"
                    y1="0"
                    y2="0"
                    gradientUnits="userSpaceOnUse"
                    spreadMethod="repeat"
                >
                    <stop offset="0" stopColor="#0c1440" />
                    <stop offset="0.5" stopColor="#22337f" />
                    <stop offset="1" stopColor="#0c1440" />
                </linearGradient>
                <linearGradient id={shadeLeft} x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0" stopColor="#000" stopOpacity="0.15" />
                    <stop offset="1" stopColor="#000" stopOpacity="0.55" />
                </linearGradient>
                <linearGradient id={shadeRight} x1="1" x2="0" y1="0" y2="0">
                    <stop offset="0" stopColor="#000" stopOpacity="0.15" />
                    <stop offset="1" stopColor="#000" stopOpacity="0.55" />
                </linearGradient>
                <linearGradient id={valance} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#0a0e24" />
                    <stop offset="1" stopColor="#1f2756" />
                </linearGradient>
                <linearGradient id={beam} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#ffe8c4" stopOpacity="0.42" />
                    <stop offset="1" stopColor="#ffe8c4" stopOpacity="0.12" />
                </linearGradient>
                <radialGradient id={pool}>
                    <stop offset="0" stopColor="#ffd9a6" stopOpacity="0.35" />
                    <stop offset="1" stopColor="#ffd9a6" stopOpacity="0" />
                </radialGradient>
                <filter
                    id={soften}
                    x="-20%"
                    y="-20%"
                    width="140%"
                    height="140%"
                >
                    <feGaussianBlur stdDeviation="5" />
                </filter>
            </defs>
            <rect width="840" height="560" fill="#000" />
            <rect y="50" width="840" height="455" fill={`url(#${wall})`} />
            <path
                d="M380 96h80l140 372H240z"
                fill={`url(#${beam})`}
                filter={`url(#${soften})`}
            />
            <rect y="420" width="840" height="85" fill="#0a0a12" />
            <ellipse
                cx="420"
                cy="452"
                rx="210"
                ry="30"
                fill={`url(#${pool})`}
            />
            {STAGE_DUST.map(([x, y, r, opacity], index) => (
                <circle
                    key={index}
                    cx={x}
                    cy={y}
                    r={r}
                    fill="#fff4dc"
                    opacity={opacity}
                />
            ))}
            <g stroke="#0d0d16" strokeLinecap="round">
                <path d="M420 284V446" strokeWidth="4" />
                <path
                    d="M420 446l-26 22M420 446l26 22M420 446v24"
                    strokeWidth="3"
                />
            </g>
            <rect
                x="413"
                y="256"
                width="14"
                height="30"
                rx="7"
                fill="#17171f"
            />
            <rect
                x="415"
                y="259"
                width="3"
                height="18"
                rx="1.5"
                fill="#3a3a48"
            />
            <rect y="50" width="172" height="455" fill={`url(#${folds})`} />
            <rect y="50" width="172" height="455" fill={`url(#${shadeLeft})`} />
            <rect
                x="668"
                y="50"
                width="172"
                height="455"
                fill={`url(#${folds})`}
            />
            <rect
                x="668"
                y="50"
                width="172"
                height="455"
                fill={`url(#${shadeRight})`}
            />
            <path
                d="M0 50h840v46a35 12 0 0 1-70 0 35 12 0 0 1-70 0 35 12 0 0 1-70 0 35 12 0 0 1-70 0 35 12 0 0 1-70 0 35 12 0 0 1-70 0 35 12 0 0 1-70 0 35 12 0 0 1-70 0 35 12 0 0 1-70 0 35 12 0 0 1-70 0 35 12 0 0 1-70 0 35 12 0 0 1-70 0z"
                fill={`url(#${valance})`}
            />
            <rect y="505" width="840" height="55" fill="#000" />
        </svg>
    );
}
