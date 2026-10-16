import type {FirmwareHistoryEntry} from 'src/utils/era-firmware-catalog';

// PROTOTYPE ONLY. `?demo=history` on a board page puts sample versions before
// the published ones, so the release line can be seen long, across storage
// changes, and with a connected keyboard's ring without a keyboard; `&count=N`
// sets how many versions the line holds in all. Samples have no file, are
// never in the catalog, and are marked wherever they show.

export const SAMPLE_TEXT = {
  tag: 'Sample',
  noFile: 'Sample version: no file',
  caption: (samples: number) =>
    `Demo: ${samples} faded sample versions before the published ones, not published firmware.`,
} as const;

/** The version the demo's pretend keyboard reports (sample format "b"). */
export const SAMPLE_CONNECTED_VERSION = '260819R1';

// "a" and "b" are sample storage formats; "published" shares the storage key
// of the oldest published version, so the line breaks only between samples.
const SAMPLES = [
  ['260704R1', 'a', 'First public build', '첫 공개 빌드'],
  ['260711R1', 'a', 'Tap Dance timing fixes', '탭댄스 판정 시간 수정'],
  ['260718R2', 'a', 'RGB sleep timeout', 'RGB 절전 시간 추가'],
  ['260801R1', 'b', 'Six layers, new storage layout', '레이어 6개, 새 저장 형식'],
  ['260808R1', 'b', 'Mouse key acceleration presets', '마우스 키 가속 프리셋'],
  ['260819R1', 'b', 'Macro playback reliability', '매크로 재생 안정성 개선'],
  ['260826R1', 'b', 'Split link speed setting', '스플릿 링크 속도 설정'],
  ['260905R1', 'published', 'Maker USB identities; authorize again', '메이커별 USB 식별자, 연결 다시 허용'],
  ['260912R1', 'published', 'USB polling rate option', 'USB 폴링 속도 옵션'],
  ['260919R1', 'published', 'Bootloader jump from SYSTEM', 'SYSTEM에서 부트로더 진입'],
  ['260926R1', 'published', 'Debounce profiles, with a longer sample note to show how a note wraps', '디바운스 프로필, 메모 줄바꿈을 보여 주는 긴 샘플 메모'],
  ['260930R1', 'published', 'Lighting key fixes', '조명 키 수정'],
] as const;

// Older samples for a long line: a release every week or two, and a new
// storage format every dozen or few dozen versions. The newest run keeps
// format "a", so it joins the oldest hand-written samples unbroken.
const OLDER_DAYS = [7, 9, 6, 12, 8, 5, 10, 14, 7, 11];
const OLDER_RUNS = [5, 17, 23, 11, 29, 19, 14, 26];
const OLDER_NOTES = [
  ['Keymap storage fixes', '키맵 저장 수정'],
  ['Encoder direction option', '인코더 방향 옵션'],
  ['Lighting effect speed range', '조명 효과 속도 범위'],
  ['Tap Dance edge cases', '탭댄스 예외 상황 수정'],
  ['USB wake-up reliability', 'USB 깨우기 안정성'],
  ['Combo timing option', '콤보 판정 시간 옵션'],
  ['Longer macros', '매크로 길이 제한 확대'],
  ['Indicator LED settings', '표시 LED 설정'],
  ['Faster start-up', '시작 시간 단축'],
  ['NKRO toggle', 'NKRO 전환'],
  ['Debounce fixes', '디바운스 수정'],
  ['Layer indicator colours', '레이어 표시 색상'],
] as const;
/** Enough for any line the demo is asked for, without dates running out. */
const MAX_SAMPLES = 400;

/** `count` sample versions older than the hand-written ones, oldest first. */
const olderSamples = (count: number) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = new Date(Date.UTC(2026, 6, 4));
  const samples: [string, string, string, string][] = [];
  let run = 0;
  let left = OLDER_RUNS[0];
  for (let index = 0; index < count; index++) {
    date.setUTCDate(date.getUTCDate() - OLDER_DAYS[index % OLDER_DAYS.length]);
    if (left === 0) {
      run += 1;
      left = OLDER_RUNS[run % OLDER_RUNS.length];
    }
    left -= 1;
    const [en, ko] = OLDER_NOTES[index % OLDER_NOTES.length];
    samples.unshift([
      `${pad(date.getUTCFullYear() % 100)}${pad(date.getUTCMonth() + 1)}${pad(
        date.getUTCDate(),
      )}R${index % 13 === 12 ? 2 : 1}`,
      run === 0 ? 'a' : `older-${run}`,
      en,
      ko,
    ]);
  }
  return samples;
};

/**
 * Sample versions, oldest first, ahead of a board's published ones: `count`
 * versions in all, or the twelve hand-written samples when it is not given.
 */
export const withSampleHistory = (
  published: FirmwareHistoryEntry[],
  count = SAMPLES.length + published.length,
): FirmwareHistoryEntry[] => {
  const [oldest] = published;
  if (!oldest) {
    return published;
  }
  const wanted = Math.min(Math.max(count - published.length, 0), MAX_SAMPLES);
  const samples: (readonly [string, string, string, string])[] =
    wanted <= SAMPLES.length
      ? SAMPLES.slice(SAMPLES.length - wanted)
      : [...olderSamples(wanted - SAMPLES.length), ...SAMPLES];
  return [
    ...samples.map(([version, format, en, ko]) => ({
      file: {version, url: '', size: oldest.file.size, sha256: ''},
      storageKey: format === 'published' ? oldest.storageKey : {sample: format},
      note: {en, ko},
      draft: false,
      sample: true as const,
    })),
    ...published,
  ];
};
