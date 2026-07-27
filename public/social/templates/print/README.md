# 공용 인쇄(A4) 템플릿 — templates/print/

단원별 인쇄 자료(비주얼싱킹 학습지·페이퍼크래프트 도안)가 공유하는 A4 인쇄 스타일입니다.
첫 적용 예시는 `units/5-2-2/visual/` 과 `units/5-2-2/craft/` 입니다.

## 새 단원 인쇄 자료 만드는 법

1. `units/5-2-2/visual/`(또는 `craft/`)를 `units/<새id>/...`로 **복사**합니다.
2. `index.html` 안의 내용(제목·칩·SVG·문항)을 새 단원 콘텐츠로 교체합니다.
   - 콘텐츠 SVG와 단원 전용 스타일은 각 `index.html`에 **인라인**으로 둡니다(빌드 도구 없음).
   - 학습 내용은 반드시 해당 단원의 게임/교과 내용과 수치·표기를 일치시킵니다.
3. PDF를 다시 만듭니다: 세션 스크래치패드의 `gen-pdf.mjs`(Playwright `page.pdf`, A4,
   Noto Sans KR 로컬 셔밍) 실행 → `visual.pdf`/`craft.pdf`를 같은 폴더에 커밋.
4. `public/social/js/curriculum.js`에서 해당 단원 deliverable을
   `{ status:"ready", href:"units/<id>/visual/", note:"..." }` 로 바꿉니다.

## ⚠ 캐시버스팅 규칙 (중요)

배포 워크플로(pages.yml)의 자동 `?v=SHA` 치환은 **깊이 2까지의 HTML + js/css/vendor 접두사**만
대상입니다. 단원 인쇄 페이지(`units/<id>/.../index.html`)는 대상이 아니므로,
`print-base.css`를 **수정할 때마다** 각 인쇄 페이지의 링크 버전을 손으로 올려야 합니다:

```html
<link rel="stylesheet" href="../../../templates/print/print-base.css?v=2">
```

## 규약 요약

- 종이 1장 = `<section class="a4-page">` (210×297mm, 안쪽 여백 10mm, 넘침 숨김)
- 화면 = 회색 배경 미리보기 + 상단 툴바(🖨 인쇄, PDF 다운로드, 자료실로)
- `.no-print`/`.screen-only` = 인쇄 시 숨김 (예: 교사용 정답 `<details>`)
- 공작 선: `.cut` 실선=자르기 · `.fold` 점선=접기 · `.cutout-hatch` 빗금=오려내기
- 인쇄면에는 이모지 금지(플랫폼별 렌더 차이) — 아이콘은 전부 SVG로 그립니다.
- 글꼴: Noto Sans KR(웹폰트) → 오프라인 PC는 Malgun Gothic 폴백. PDF에는 서브셋 임베드됨.
