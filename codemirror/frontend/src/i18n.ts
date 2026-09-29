export type Language = 'auto' | 'en' | 'ko';
const KEY = 'codemirror:language';
let language: Language = 'auto';
try { const saved = localStorage.getItem(KEY); if (saved === 'en' || saved === 'ko') language = saved; } catch { /* Browser storage may be disabled. */ }
export const isKorean = () => (language === 'auto' ? navigator.language : language).toLowerCase().startsWith('ko');
export const text = (en: string, ko: string): string => isKorean() ? ko : en;

const ko: Record<string, string> = {
  'Files': '파일', 'File actions': '파일 작업', 'Refresh files': '파일 새로고침',
  'New file': '새 파일', 'New folder': '새 폴더', 'New directory': '새 폴더',
  'Rename': '이름 변경', 'Delete': '삭제', 'Cut': '잘라내기', 'Copy': '복사', 'Paste': '붙여넣기',
  'Upload files': '파일 업로드', 'Upload folder': '폴더 업로드', 'Name': '이름',
  'Create': '만들기', 'Cancel': '취소', 'Save': '저장', 'Save file': '파일 저장',
  'Save file (Ctrl+S)': '파일 저장 (Ctrl+S)', 'Close tab': '탭 닫기', 'Open files': '열린 파일',
  'Validate YAML': 'YAML 검사', 'Reload YAML': 'YAML 다시 불러오기', 'Restart HA': 'HA 재시작',
  'Home Assistant actions': 'Home Assistant 작업', 'Entity suggestions': '엔티티 자동완성',
  'Refresh entities': '엔티티 새로고침', 'Loading entities…': '엔티티 불러오는 중…',
  'Entities unavailable': '엔티티 연결 불가', 'Home Assistant connected': 'Home Assistant 연결됨',
  'Home Assistant connected; no entities returned': '연결됨: 엔티티 없음',
  'Appearance': '화면 설정', 'Appearance settings': '화면 설정', 'Close appearance settings': '화면 설정 닫기',
  'Customize the editor to your preference.': '편집기 화면과 언어를 설정하세요.',
  'Language': '표시 언어', 'Automatic': '자동', 'Theme': '테마', 'Light': '밝게', 'Dark': '어둡게',
  'Color & guides': '색상과 안내선', 'Indentation guides': '들여쓰기 안내선',
  'Colored spaces': '색상 공백', 'Vertical lines': '세로선', 'Guide opacity': '안내선 불투명도',
  'Editor': '편집기', 'Font size': '글꼴 크기', 'Line wrapping': '자동 줄바꿈',
  'Wrap long lines to fit the editor': '긴 줄을 편집기 너비에 맞춰 표시합니다',
  'Rainbow brackets': '괄호 색상 표시', 'Color brackets by nesting level': '중첩 단계에 따라 괄호 색상을 표시합니다',
  'Format YAML and JSON on save': '저장 시 YAML·JSON 서식 정리',
  'Apply Prettier formatting before saving': '저장 전에 Prettier로 서식을 정리합니다',
  'Reset defaults': '기본값 복원', 'Done': '완료', 'Preview Markdown': 'Markdown 미리보기',
  'Hide preview': '미리보기 닫기', 'No file selected': '선택한 파일 없음', 'No file': '파일 없음',
  'Choose a file to start editing': '편집할 파일을 선택하세요',
  'Markdown · preview omits embedded resources': 'Markdown · 미리보기에서 외부 삽입 리소스 제외',
  'Undo changes': '실행 취소', 'Undo changes (Ctrl+Z)': '실행 취소 (Ctrl+Z)',
  'Redo changes': '다시 실행', 'Redo changes (Ctrl+Shift+Z)': '다시 실행 (Ctrl+Shift+Z)',
  'Decrease indentation': '내어쓰기', 'Decrease indentation (Shift+Tab)': '내어쓰기 (Shift+Tab)',
  'Increase indentation': '들여쓰기', 'Increase indentation (Tab)': '들여쓰기 (Tab)',
  'Menu': '메뉴', 'Code editor': '코드 편집기', 'File browser': '파일 탐색기', 'Supported files': '파일 트리',
  'Ready': '준비됨', 'Modified': '수정됨', 'Modified (Warnings)': '수정됨 (경고)',
  'Loading...': '불러오는 중...', 'Saving...': '저장 중...', 'Formatting...': '서식 정리 중...',
  'Saved': '저장됨', 'Failed to save': '저장 실패', 'Save failed': '저장 실패',
  'Invalid config': '설정 오류', 'Cannot save': '저장할 수 없음', 'Click for details': '자세히 보기',
  'Cannot save invalid configuration': '오류가 있는 설정은 저장할 수 없습니다',
  'Cannot save formatted configuration': '서식을 정리한 설정을 저장할 수 없습니다',
  'Restore Valid State': '유효한 상태로 복원', 'Restored to valid state': '유효한 상태로 복원됨',
  'Close': '닫기', 'Validation details': '검사 결과', 'Initialization failed': '초기화 실패',
  'Saved, checking config...': '저장됨, 설정 검사 중...', 'Saved, config valid': '저장됨, 설정 정상',
  'Saved, config invalid': '저장됨, 설정 오류', 'Saved, validation unavailable': '저장됨, 검사 연결 불가',
  'Running Home Assistant validation': 'Home Assistant 설정 검사 중', 'HA validation passed': 'HA 검사 통과',
  'Home Assistant validation': 'Home Assistant 설정 검사',
  'Home Assistant validation failed': 'Home Assistant 설정 검사 실패',
  'Home Assistant validation unavailable': 'Home Assistant 설정 검사 연결 불가',
  'File created': '파일 생성됨', 'Directory created': '폴더 생성됨', 'Creation failed': '생성 실패',
  'File operation completed': '파일 작업 완료', 'File operation failed': '파일 작업 실패',
  'An entry with this name already exists': '같은 이름의 항목이 이미 있습니다',
  'A file with this name already exists': '같은 이름의 파일이 이미 있습니다',
  'Save your changes before continuing': '계속하기 전에 변경 내용을 저장하세요',
  'Home Assistant uses saved files': 'Home Assistant는 저장된 파일을 사용합니다',
  'Current document has syntax errors': '현재 문서에 구문 오류가 있습니다',
  'Saved HA configuration was not checked': '저장된 HA 설정은 검사하지 않았습니다',
  'Checking saved HA configuration…': '저장된 HA 설정 검사 중…',
  'Saved HA configuration is valid': '저장된 HA 설정이 유효합니다',
  'Saved HA configuration is invalid': '저장된 HA 설정에 오류가 있습니다',
  'HA validation unavailable': 'HA 설정 검사 연결 불가',
  'Unsaved edits are checked locally only': '미저장 내용은 로컬에서만 검사합니다',
  'Unsaved edits: syntax checked locally; save to validate in HA': '미저장 내용: 로컬 구문 검사 완료, HA 검사는 저장 후 가능합니다',
  'Checking configuration and restarting HA…': '설정 검사 및 HA 재시작 중…',
  'Checking configuration and reloading YAML…': '설정 검사 및 YAML 다시 불러오는 중…',
  'Home Assistant action failed': 'Home Assistant 작업 실패', 'No entities available': '사용 가능한 엔티티가 없습니다',
  'Use Refresh entities to connect to Home Assistant': '엔티티 새로고침으로 Home Assistant에 연결하세요',
  'Open a YAML file for entity suggestions': '엔티티 자동완성을 사용하려면 YAML 파일을 여세요',
  'Restart Home Assistant Core? Automations and the HA UI will be briefly unavailable.': 'Home Assistant Core를 재시작할까요? 자동화와 HA 화면이 잠시 중단됩니다.',
  'This file is stored but cannot be edited as text': '저장된 파일이지만 텍스트로 편집할 수 없습니다',
  'Compressing folder…': '폴더 압축 중…', 'Uploading and extracting folder…': '폴더 업로드 및 압축 해제 중…',
  'Folder upload failed': '폴더 업로드 실패', 'Drop one folder at a time': '한 번에 폴더 하나를 놓으세요',
  'Uncompressed folder exceeds the upload limit': '압축 해제한 폴더 크기가 업로드 한도를 초과합니다',
  'Folder exceeds 10000 entries or 32 levels': '폴더가 항목 10,000개 또는 깊이 32단계를 초과합니다',
};
export const codeMirrorKorean: Record<string, string> = {
  'Control character': '제어 문자', 'Selection deleted': '선택 영역 삭제됨', 'Folded lines': '접힌 줄',
  'Unfolded lines': '펼친 줄', 'to': '~', 'folded code': '접힌 코드', 'unfold': '펼치기',
  'Fold line': '줄 접기', 'Unfold line': '줄 펼치기', 'Go to line': '줄로 이동', 'go': '이동', 'close': '닫기',
  'Find': '찾기', 'Replace': '바꾸기', 'next': '다음', 'previous': '이전', 'all': '전체',
  'match case': '대소문자 구분', 'by word': '단어 단위', 'regexp': '정규식', 'replace': '바꾸기',
  'replace all': '모두 바꾸기', 'No matches': '일치하는 항목 없음', 'current match': '현재 일치 항목',
  'on line': '줄', 'replaced $ matches': '$개 항목 바꿈', 'replaced match on line $': '$번 줄 항목 바꿈',
  'Completions': '자동완성', 'Diagnostics': '진단', 'No diagnostics': '진단 없음',
};
export function translate(value: string): string {
  if (!isKorean()) return value;
  if (ko[value]) return ko[value];
  const patterns: [RegExp, (...parts: string[]) => string][] = [
    [/^(\d+) entities$/, count => `엔티티 ${count}개`],
    [/^Create in (.+)$/, path => `생성 위치: ${path}`],
    [/^Compressing folder… (\d+)\/(\d+)$/, (done, total) => `폴더 압축 중… ${done}/${total}`],
    [/^(.+): (\d+) files uploaded$/, (path, count) => `${path}: 파일 ${count}개 업로드 완료`],
    [/^(\d+)\/(\d+) uploaded to (.+)$/, (done, total, path) => `${path}: ${done}/${total}개 업로드 완료`],
    [/^(.+): uploaded$/, path => `${path}: 업로드 완료`],
    [/^Failed to load (.+)$/, path => `불러오기 실패: ${path}`],
  ];
  for (const [pattern, format] of patterns) { const match = value.match(pattern); if (match) return format(...match.slice(1)); }
  return value;
}

/** Translate only app chrome, never editor contents, filenames, entity data or Markdown. */
export function initLanguage(): void {
  const picker = document.getElementById('appearance-language') as HTMLSelectElement;
  picker.value = language;
  const sources = new WeakMap<Text, { source: string; rendered: string }>();
  const attributes = new WeakMap<Element, Map<string, { source: string; rendered: string }>>();
  const excluded = '.cm-editor, #file-list, #markdown-preview, #document-tabs, #current-filename, #mobile-filename, #validation-details-content';
  function walk(node: Node) {
    const el = node instanceof Element ? node : node.parentElement;
    if (el?.closest(excluded) || el?.closest('script, style')) return;
    if (node instanceof Text) {
      const old = sources.get(node);
      const source = old && node.data === old.rendered ? old.source : node.data;
      const value = source.trim().replace(/\s+/g, ' ');
      const replacement = translate(value);
      const rendered = replacement === value ? source : source.replace(source.trim(), replacement);
      sources.set(node, { source, rendered });
      if (node.data !== rendered) node.data = rendered;
    } else {
      if (node instanceof Element) {
        const saved = attributes.get(node) || new Map();
        for (const key of ['aria-label', 'title', 'placeholder']) {
          const value = node.getAttribute(key); if (value === null) continue;
          const old = saved.get(key); const source = old && value === old.rendered ? old.source : value;
          const rendered = translate(source); saved.set(key, { source, rendered });
          if (value !== rendered) node.setAttribute(key, rendered);
        }
        attributes.set(node, saved);
      }
      for (const child of node.childNodes) walk(child);
    }
  }
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(walk); else walk(record.target);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label', 'placeholder'] });
  function apply() {
    document.documentElement.lang = isKorean() ? 'ko' : 'en';
    walk(document.body);
    window.dispatchEvent(new Event('language-changed'));
  }
  picker.addEventListener('change', () => {
    const value = picker.value;
    language = value === 'ko' || value === 'en' ? value : 'auto';
    try { localStorage.setItem(KEY, language); } catch { /* Keep this session's choice. */ }
    apply();
  });
  window.addEventListener('languagechange', () => { if (language === 'auto') apply(); });
  apply();
}
