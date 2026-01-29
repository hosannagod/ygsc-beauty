# 🚀 Render.com 배포 가이드 (5분 완료!)

## ✅ 준비사항
- GitHub 계정
- Render.com 계정 (무료)

## 📝 배포 단계

### 1단계: GitHub에 코드 푸시

먼저 이 프로젝트를 GitHub에 올립니다:

```bash
# GitHub에서 새 리포지토리 생성 (예: ygsc-beauty)
# 그 다음 로컬에서:

cd /home/user/webapp

# 원격 리포지토리 추가
git remote add origin https://github.com/YOUR_USERNAME/ygsc-beauty.git

# 코드 푸시
git push -u origin main
```

### 2단계: Render.com 가입

1. https://render.com 접속
2. **"Get Started for Free"** 클릭
3. GitHub 계정으로 로그인

### 3단계: New Web Service 생성

1. **Dashboard**에서 **"New +"** 버튼 클릭
2. **"Web Service"** 선택
3. **"Connect a repository"** 클릭
4. GitHub 권한 승인
5. **ygsc-beauty** 리포지토리 선택

### 4단계: 서비스 설정

다음과 같이 입력:

| 항목 | 값 |
|-----|-----|
| **Name** | `ygsc-beauty` (또는 원하는 이름) |
| **Region** | `Singapore` (한국에서 가장 가까움) |
| **Branch** | `main` |
| **Root Directory** | (비워두기) |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Plan** | `Free` |

### 5단계: 환경 변수 설정

**Advanced** 섹션에서 환경 변수 추가:

```
NODE_ENV=production
```

**PORT는 설정하지 마세요!** Render가 자동으로 할당합니다.

### 6단계: 배포!

1. **"Create Web Service"** 버튼 클릭
2. 자동으로 배포 시작! ⏳ (약 2-3분 소요)
3. 배포 로그를 실시간으로 확인할 수 있습니다

### 7단계: 완료!

배포가 완료되면:
- **Your service is live 🎉** 메시지 표시
- 상단에 URL이 나타납니다 (예: `https://ygsc-beauty.onrender.com`)
- 해당 URL로 접속하면 사이트 확인 가능!

## 🔗 주요 URL

배포 후 접속 가능한 주소:

- **메인 페이지**: `https://your-app-name.onrender.com`
- **관리자 로그인**: `https://your-app-name.onrender.com/admin/login`
- **관리자 대시보드**: `https://your-app-name.onrender.com/admin`

## 🎯 접속 방법

### 1. 메인 페이지에서
- 상단 네비게이션의 **"ADMIN"** 링크 클릭
- 또는 Footer의 **"관리자 로그인"** 링크 클릭

### 2. 직접 URL 입력
```
https://your-app-name.onrender.com/admin/login
```

### 3. 로그인 정보
- **아이디**: `admin`
- **비밀번호**: `admin123`

⚠️ **중요**: 첫 배포 후 반드시 비밀번호를 변경하세요!

## ⚡ 자동 배포 설정

Render.com은 **자동 배포**를 지원합니다:

1. GitHub의 `main` 브랜치에 코드 푸시
2. Render가 자동으로 감지하고 재배포
3. 약 2-3분 후 업데이트 완료!

```bash
# 로컬에서 수정 후
git add .
git commit -m "Update something"
git push origin main

# Render.com에서 자동으로 재배포됨!
```

## 📊 데이터베이스

SQLite 데이터베이스는 Render의 **Persistent Disk**에 저장됩니다:

1. Render Dashboard > 서비스 선택
2. **"Storage"** 탭
3. **"Add Disk"** 클릭
4. Mount Path: `/app/data`
5. Size: `1GB` (Free tier)

이렇게 하면 서버 재시작 후에도 데이터가 유지됩니다!

## 🔧 문제 해결

### 배포 실패 시

1. **Logs** 탭에서 에러 확인
2. 일반적인 문제:
   - `npm install` 실패 → `package.json` 확인
   - Port 에러 → `PORT` 환경 변수 제거 (Render가 자동 할당)
   - 시작 실패 → `npm start` 명령어 확인

### 느린 첫 로딩 (Cold Start)

무료 플랜은 15분 동안 요청이 없으면 슬립 모드로 전환됩니다:
- 첫 접속 시 30초~1분 소요
- 이후는 정상 속도
- 유료 플랜으로 업그레이드하면 해결 가능

### 데이터베이스 초기화

처음 배포 시 데이터베이스가 자동으로 생성됩니다:
- SQLite 파일: `./data/ygsc.db`
- 테이블과 관리자 계정 자동 생성

## 🎨 커스텀 도메인 (선택사항)

무료로 커스텀 도메인을 연결할 수 있습니다:

1. Render Dashboard > 서비스 선택
2. **"Settings"** 탭
3. **"Custom Domain"** 섹션
4. 도메인 추가 (예: `ygsc.com`)
5. DNS 설정 (A 레코드 또는 CNAME)
6. 자동으로 SSL 인증서 발급!

## 💰 비용

| 플랜 | 가격 | 특징 |
|-----|------|------|
| **Free** | $0 | 750시간/월, 슬립 모드, 공유 CPU |
| **Starter** | $7/월 | 항상 켜져있음, 전용 CPU |
| **Standard** | $25/월 | 더 많은 리소스, 오토스케일링 |

**추천**: 테스트는 Free, 실제 운영은 Starter ($7/월)

## 📱 모니터링

Render Dashboard에서 실시간 모니터링:
- **Metrics**: CPU, 메모리, 네트워크 사용량
- **Logs**: 실시간 서버 로그
- **Events**: 배포 히스토리

## 🎉 완료!

축하합니다! 5분 만에 배포 완료! 🚀

**다음 단계**:
1. ✅ 사이트 접속 확인
2. ✅ 관리자 로그인 테스트
3. ✅ 지원서 제출 테스트
4. ⚠️ 관리자 비밀번호 변경
5. 📊 Persistent Disk 추가 (데이터 보존)

---

**문의**: ygsc_beauty@startup.com
