# YGSC Beauty Build-up Platform

## 프로젝트 개요
- **이름**: YGSC (Young Global Startup Community) Beauty Build-up Platform
- **목표**: 검증된 파트너십을 통해 K-뷰티 스타트업의 글로벌 매출을 확정하고 실행하는 전문 빌더 플랫폼
- **주요 기능**:
  - 1기 모집 안내 및 신청 시스템
  - 6개월 무제한 왕홍 라이브 방송 지원
  - 올인원 전문가 바우처 (회계/세무/법률/특허)
  - 제조사 및 자금 프리패스
  - TIPS 연계 및 직접 투자 지원
  - **관리자 대시보드** (신규 추가!)

## 완료된 기능
- ✅ 반응형 랜딩 페이지 (모바일/태블릿/데스크톱)
- ✅ 모집 개요 섹션 (모집 기간, 대상, 규모)
- ✅ YGSC 1기 독점 혜택 4가지 상세 안내
- ✅ 지원서 제출 폼 (대시보드 형식)
- ✅ **Cloudflare D1 데이터베이스 통합** (신규!)
- ✅ **관리자 로그인 시스템** (신규!)
- ✅ **관리자 대시보드** (신규!)
  - 실시간 통계 (전체/대기/승인/거절)
  - 지원서 목록 및 필터링
  - 지원서 상세 보기
  - 상태 변경 (승인/거절/대기)
- ✅ API 엔드포인트 (`/api/apply`, `/api/admin/*`)
- ✅ 문의 정보 섹션
- ✅ 부드러운 스크롤 애니메이션
- ✅ 골드 & 화이트 톤 미니멀리즘 디자인

## URL
- **개발 환경**: https://3000-iy9jypp8g386pn6yobbsc-dfc00ec5.sandbox.novita.ai
- **관리자 로그인**: https://3000-iy9jypp8g386pn6yobbsc-dfc00ec5.sandbox.novita.ai/admin/login
  - 아이디: `admin`
  - 비밀번호: `admin123` (⚠️ 프로덕션 배포 시 변경 필수!)
- **GitHub**: (배포 예정)
- **프로덕션**: (Cloudflare Pages 배포 예정)

## 주요 URI 및 기능

### 웹 페이지
- `/` - 메인 랜딩 페이지
  - `#overview` - 모집 개요
  - `#benefits` - 1기 독점 혜택
  - `#apply` - 지원하기 (신청 폼)
  - `#contact` - 문의하기
- `/admin/login` - 관리자 로그인
- `/admin` - 관리자 대시보드

### API 엔드포인트

#### 공개 API
- `POST /api/apply` - 지원서 제출
  - **파라미터**:
    - `name` (string, required): 대표자명
    - `phone` (string, required): 연락처
    - `email` (string, required): 이메일
    - `company` (string, required): 기업/브랜드명
    - `type` (string, required): 기업 유형 ("신규 빌드업" | "재고 스케일업")
    - `payment` (string, required): 결제 방식 ("Cash" | "Equity")
    - `funding` (string, required): 자부담금 확보 여부 ("예" | "준비 중")
    - `motivation` (string, required): 지원 동기 및 사업 계획
  - **응답**:
    ```json
    {
      "success": true,
      "message": "지원서가 성공적으로 제출되었습니다.",
      "id": 1
    }
    ```

#### 관리자 API (인증 필요)
- `POST /api/admin/login` - 관리자 로그인
  - **파라미터**: `{ username, password }`
  - **응답**: `{ success: true, token: "..." }`

- `GET /api/admin/applications` - 지원서 목록 조회
  - **쿼리 파라미터** (선택):
    - `status`: "pending" | "approved" | "rejected"
    - `type`: "신규 빌드업" | "재고 스케일업"
    - `search`: 검색어 (기업명, 이름, 이메일)
  - **헤더**: `Authorization: Bearer {token}`
  - **응답**:
    ```json
    {
      "applications": [...],
      "stats": {
        "total": 10,
        "pending": 5,
        "approved": 3,
        "rejected": 2
      }
    }
    ```

- `GET /api/admin/applications/:id` - 지원서 상세 조회
  - **헤더**: `Authorization: Bearer {token}`

- `PUT /api/admin/applications/:id` - 지원서 상태 변경
  - **파라미터**: `{ status: "pending" | "approved" | "rejected" }`
  - **헤더**: `Authorization: Bearer {token}`

## 아직 구현되지 않은 기능
- ⏳ 이메일 자동 발송 시스템 (지원서 제출 확인, 승인/거절 알림)
- ⏳ 파일 업로드 (사업자등록증, 사업계획서 등)
- ⏳ 결제 시스템 연동
- ⏳ 지원 현황 실시간 표시 (메인 페이지)
- ⏳ 관리자 비밀번호 변경 기능
- ⏳ JWT 기반 인증 (현재는 간단한 토큰 방식)
- ⏳ 지원서 엑셀 다운로드

## 데이터 아키텍처

### 데이터 모델
**applications 테이블**:
- `id` (INTEGER): 자동 증가 기본 키
- `name` (TEXT): 대표자명
- `phone` (TEXT): 연락처
- `email` (TEXT): 이메일
- `company` (TEXT): 기업/브랜드명
- `type` (TEXT): 기업 유형
- `payment` (TEXT): 결제 방식
- `funding` (TEXT): 자부담금 확보 여부
- `motivation` (TEXT): 지원 동기 및 사업 계획
- `status` (TEXT): 상태 (pending/approved/rejected)
- `created_at` (DATETIME): 생성일시
- `updated_at` (DATETIME): 수정일시

**admin_users 테이블**:
- `id` (INTEGER): 기본 키
- `username` (TEXT): 관리자 아이디
- `password_hash` (TEXT): 암호화된 비밀번호
- `email` (TEXT): 관리자 이메일
- `created_at` (DATETIME): 생성일시

### 저장소 서비스
- **Cloudflare D1 Database**: SQLite 기반 글로벌 분산 데이터베이스
- **로컬 개발**: `.wrangler/state/v3/d1` 디렉토리의 로컬 SQLite
- **프로덕션**: Cloudflare D1 원격 데이터베이스

### 데이터 흐름
1. **지원서 제출**:
   - 사용자가 웹 폼에서 지원서 작성
   - 프론트엔드에서 `/api/apply` POST 요청
   - 백엔드에서 데이터 검증 및 D1에 저장
   - 성공/실패 응답 반환

2. **관리자 로그인**:
   - 관리자가 `/admin/login`에서 로그인
   - 인증 성공 시 토큰 발급
   - 토큰을 localStorage에 저장

3. **관리자 작업**:
   - 토큰을 포함한 API 요청
   - 지원서 목록 조회, 필터링, 검색
   - 지원서 상세 보기 및 상태 변경
   - 실시간 통계 업데이트

## 사용자 가이드

### 일반 사용자 - 지원 방법
1. 웹사이트 접속
2. "지원하기" 섹션으로 스크롤 또는 네비게이션 클릭
3. 지원서 양식 작성:
   - 대표자명, 연락처, 이메일 입력
   - 기업/브랜드명 입력
   - 기업 유형 선택 (신규 빌드업 / 재고 스케일업)
   - 결제 방식 선택 (Cash 1,000만원 / Equity 5%)
   - 자부담금 확보 여부 선택
   - 지원 동기 및 사업 계획 작성
4. 개인정보 수집 동의 체크
5. "지원서 제출하기" 버튼 클릭

### 관리자 - 지원서 관리
1. `/admin/login` 접속
2. 관리자 계정으로 로그인
   - 아이디: `admin`
   - 비밀번호: `admin123`
3. 대시보드에서 통계 확인
   - 전체 지원서 수
   - 대기/승인/거절 현황
4. 지원서 목록 조회
   - 상태별 필터링 (대기/승인/거절)
   - 기업 유형별 필터링
   - 검색 기능 (기업명, 이름, 이메일)
5. 지원서 상세 보기 (눈 아이콘 클릭)
6. 상태 변경 (승인/거절/대기로 변경)

### 문의 방법
- **이메일**: ygsc_beauty@startup.com
- **카카오톡**: 카카오톡 채널 'YGSC'

## 배포 상태
- **플랫폼**: Cloudflare Pages
- **상태**: 🟡 개발 완료, 배포 준비 중
- **기술 스택**: 
  - Hono (백엔드 프레임워크)
  - Cloudflare D1 (SQLite 데이터베이스)
  - TypeScript
  - TailwindCSS (CDN)
  - Font Awesome (아이콘)
  - Axios (HTTP 클라이언트)
- **마지막 업데이트**: 2026-01-29

## 배포 가이드

### 전제 조건
1. Cloudflare 계정 생성
2. Cloudflare API 키 발급 (Deploy 탭에서 설정)
3. GitHub 계정 (선택사항)

### 로컬 개발

#### 1. 의존성 설치
```bash
npm install
```

#### 2. D1 데이터베이스 마이그레이션 적용
```bash
npm run db:migrate:local
```

#### 3. 개발 서버 시작
```bash
# Vite 개발 서버
npm run dev

# Wrangler 개발 서버 (D1 포함)
npm run dev:sandbox
```

#### 4. PM2로 서비스 시작 (샌드박스 환경)
```bash
npm run build
pm2 start ecosystem.config.cjs
```

### 프로덕션 배포

#### 1. Cloudflare API 키 설정
- Deploy 탭에서 Cloudflare API 키 설정 완료

#### 2. D1 데이터베이스 생성
```bash
npx wrangler d1 create ygsc-beauty-production
```

생성된 `database_id`를 `wrangler.jsonc`의 `d1_databases[0].database_id`에 복사

#### 3. 프로덕션 마이그레이션 적용
```bash
npm run db:migrate:prod
```

#### 4. Cloudflare Pages 프로젝트 생성
```bash
npx wrangler pages project create ygsc-beauty \
  --production-branch main \
  --compatibility-date 2026-01-28
```

#### 5. 배포
```bash
npm run deploy:prod
```

#### 6. D1 데이터베이스 바인딩
Cloudflare Dashboard에서:
1. Pages 프로젝트 설정
2. Functions 탭
3. D1 database bindings 추가
   - Variable name: `DB`
   - D1 database: `ygsc-beauty-production`

#### 7. 관리자 비밀번호 변경 (중요!)
프로덕션 환경에서는 반드시 관리자 비밀번호를 변경하세요:
```bash
# 로컬에서 새 비밀번호 해시 생성
npx wrangler d1 execute ygsc-beauty-production --command="UPDATE admin_users SET password_hash='새로운해시' WHERE id=1"
```

### GitHub 연동 (선택사항)
```bash
# GitHub 환경 설정
# (setup_github_environment 도구 사용)

# 리포지토리에 푸시
git remote add origin https://github.com/USERNAME/ygsc-beauty.git
git push -u origin main
```

## 개발 명령어

### 빌드 및 실행
```bash
npm run build                  # 프로젝트 빌드
npm run preview                # 프로덕션 빌드 미리보기
npm run deploy                 # Cloudflare Pages 배포
npm run deploy:prod            # 프로젝트명 지정 배포
```

### 데이터베이스 관리
```bash
npm run db:migrate:local       # 로컬 마이그레이션 적용
npm run db:migrate:prod        # 프로덕션 마이그레이션 적용
npm run db:console:local       # 로컬 DB 콘솔
npm run db:console:prod        # 프로덕션 DB 콘솔
```

### 개발 서버
```bash
npm run dev                    # Vite 개발 서버
npm run dev:sandbox            # Wrangler + D1 로컬 서버
```

### 유틸리티
```bash
npm run clean-port             # 포트 3000 정리
npm test                       # 서비스 테스트
npm run cf-typegen             # TypeScript 타입 생성
```

### PM2 (샌드박스 환경)
```bash
pm2 start ecosystem.config.cjs  # 서비스 시작
pm2 list                        # 서비스 목록
pm2 logs --nostream             # 로그 확인
pm2 restart webapp              # 재시작
pm2 delete webapp               # 삭제
```

## 디자인 컨셉
- **미니멀리즘**: 깔끔하고 직관적인 레이아웃
- **골드 & 화이트**: 뷰티의 세련미를 표현
- **반응형**: 모든 디바이스에서 완벽한 경험
- **애니메이션**: 부드러운 페이드인 및 호버 효과
- **관리자 UI**: 직관적이고 효율적인 데이터 관리

## 보안 고려사항
- ⚠️ **관리자 비밀번호**: 프로덕션 배포 시 반드시 변경
- ⚠️ **JWT 토큰**: 현재는 간단한 토큰 방식, 향후 JWT로 업그레이드 권장
- ✅ **SQL Injection 방지**: Prepared Statements 사용
- ✅ **입력 검증**: 모든 API 엔드포인트에서 입력 검증
- ⚠️ **HTTPS**: Cloudflare Pages는 자동으로 HTTPS 제공

## 라이선스
© 2026 YGSC. All rights reserved.

## 추천 다음 단계

### 우선순위 높음
1. ✅ ~~D1 데이터베이스 통합~~ (완료!)
2. ✅ ~~관리자 대시보드 구축~~ (완료!)
3. 🔄 **Cloudflare Pages 배포** (진행 중)
4. 🔜 JWT 기반 인증 시스템
5. 🔜 관리자 비밀번호 변경 기능

### 우선순위 중간
6. 이메일 자동 발송 (SendGrid/Resend)
7. 파일 업로드 (Cloudflare R2)
8. 지원서 엑셀 다운로드
9. 프로덕션 환경 모니터링

### 우선순위 낮음
10. 결제 시스템 연동
11. 지원 현황 실시간 표시
12. 고급 통계 및 차트
13. 다국어 지원 (영어/중국어)
