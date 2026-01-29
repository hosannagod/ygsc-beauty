# YGSC Beauty Build-up Platform - 자체 배포 가이드

## 🎉 완성!

Node.js 기반 자체 서버로 배포 가능한 YGSC Beauty Build-up Platform입니다.
Cloudflare 없이 어떤 서버에서도 실행할 수 있습니다!

### ✅ 주요 특징

- **독립 실행형 서버**: Node.js + Hono 프레임워크
- **내장 SQLite 데이터베이스**: 별도 DB 서버 불필요
- **관리자 대시보드**: 실시간 지원서 관리
- **완전한 기능**: 지원서 제출, 필터링, 검색, 상태 관리
- **간단한 배포**: PM2로 프로덕션 관리

## 🌐 현재 접속 URL

**개발 환경 (Sandbox)**:
```
https://3000-iy9jypp8g386pn6yobbsc-dfc00ec5.sandbox.novita.ai
```

**관리자 로그인**:
```
https://3000-iy9jypp8g386pn6yobbsc-dfc00ec5.sandbox.novita.ai/admin/login
```

**관리자 계정**:
- 아이디: `admin`
- 비밀번호: `admin123`

⚠️ **프로덕션 배포 시 반드시 비밀번호를 변경하세요!**

## 📦 배포 방법

### 방법 1: 자체 서버 (VPS, AWS, Azure, GCP 등)

#### 1. 서버 준비
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y nodejs npm git

# 또는 nvm 사용
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
```

#### 2. 프로젝트 클론
```bash
cd /var/www  # 또는 원하는 디렉토리
git clone <your-repo-url> ygsc-beauty
cd ygsc-beauty
```

#### 3. 의존성 설치
```bash
npm install
```

#### 4. 환경 변수 설정 (선택사항)
```bash
# .env 파일 생성
echo "PORT=3000" > .env
echo "NODE_ENV=production" >> .env
```

#### 5. PM2 설치 및 서버 시작
```bash
# PM2 글로벌 설치
npm install -g pm2

# 서버 시작
pm2 start ecosystem.config.cjs

# PM2를 시스템 시작 시 자동 실행 설정
pm2 startup
pm2 save
```

#### 6. Nginx 리버스 프록시 설정 (권장)
```nginx
# /etc/nginx/sites-available/ygsc-beauty
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Nginx 설정 활성화
sudo ln -s /etc/nginx/sites-available/ygsc-beauty /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 7. SSL 인증서 (Let's Encrypt)
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 방법 2: Render.com (무료 호스팅)

#### 1. Render.com 계정 생성
https://render.com 에서 계정 생성

#### 2. New Web Service 생성
- GitHub 리포지토리 연결
- Build Command: `npm install`
- Start Command: `npm start`
- Environment: `Node`

#### 3. 환경 변수 설정
- `NODE_ENV=production`
- `PORT=10000` (Render가 자동으로 할당)

#### 4. 배포
자동으로 배포됩니다!

### 방법 3: Railway.app (간단한 배포)

#### 1. Railway 계정 생성
https://railway.app 에서 계정 생성

#### 2. New Project
- Deploy from GitHub repo 선택
- 리포지토리 선택

#### 3. 설정
자동으로 Node.js 프로젝트를 인식하고 배포합니다!

### 방법 4: Fly.io

#### 1. Fly CLI 설치
```bash
curl -L https://fly.io/install.sh | sh
```

#### 2. 로그인 및 초기화
```bash
fly auth login
fly launch
```

#### 3. 배포
```bash
fly deploy
```

## 📊 데이터베이스 관리

### SQLite 데이터베이스 위치
```
./data/ygsc.db
```

### 데이터베이스 백업
```bash
# 백업
cp data/ygsc.db data/ygsc.db.backup-$(date +%Y%m%d)

# 복원
cp data/ygsc.db.backup-20260129 data/ygsc.db
pm2 restart ygsc-beauty
```

### 데이터베이스 확인
```bash
# sqlite3 설치
sudo apt install sqlite3

# 데이터베이스 접속
sqlite3 data/ygsc.db

# 테이블 목록
.tables

# 지원서 확인
SELECT * FROM applications;

# 나가기
.exit
```

## 🔧 관리 명령어

### 개발 환경
```bash
npm start                # 서버 시작 (tsx 사용)
npm test                 # 서버 테스트 (curl)
```

### 프로덕션 환경 (PM2)
```bash
pm2 start ecosystem.config.cjs    # 서버 시작
pm2 list                           # 프로세스 목록
pm2 logs ygsc-beauty              # 로그 확인
pm2 logs ygsc-beauty --lines 100  # 최근 100줄
pm2 monit                          # 실시간 모니터링
pm2 restart ygsc-beauty           # 재시작
pm2 stop ygsc-beauty              # 중지
pm2 delete ygsc-beauty            # 삭제
```

### 데이터베이스
```bash
# 지원서 수 확인
sqlite3 data/ygsc.db "SELECT COUNT(*) FROM applications;"

# 최근 지원서 10개
sqlite3 data/ygsc.db "SELECT * FROM applications ORDER BY created_at DESC LIMIT 10;"

# 상태별 통계
sqlite3 data/ygsc.db "SELECT status, COUNT(*) FROM applications GROUP BY status;"
```

## 🔐 보안 설정

### 1. 관리자 비밀번호 변경
```bash
# 데이터베이스에서 직접 변경
sqlite3 data/ygsc.db

UPDATE admin_users SET password_hash='새로운해시' WHERE username='admin';
.exit
```

### 2. 방화벽 설정 (Ubuntu)
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp
sudo ufw enable
```

### 3. 파일 권한
```bash
chmod 600 data/ygsc.db  # 데이터베이스는 소유자만 읽기/쓰기
chmod 700 data/         # 데이터 디렉토리는 소유자만 접근
```

## 📝 환경 변수

`.env` 파일을 생성하여 설정:

```env
# 서버 포트
PORT=3000

# 환경
NODE_ENV=production

# 데이터베이스 경로 (기본값: ./data/ygsc.db)
DATABASE_PATH=./data/ygsc.db
```

## 🚀 성능 최적화

### PM2 클러스터 모드
```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'ygsc-beauty',
    script: 'npx',
    args: 'tsx server.ts',
    instances: 'max',  // CPU 코어 수만큼 인스턴스 생성
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
}
```

### Nginx 캐싱
```nginx
# 정적 파일 캐싱
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## 📦 프로젝트 구조

```
ygsc-beauty/
├── server.ts              # 메인 서버 파일 (Node.js + Hono)
├── src/
│   ├── index.tsx          # Cloudflare Workers용 (옵션)
│   └── admin.tsx          # 관리자 대시보드 HTML
├── data/
│   └── ygsc.db            # SQLite 데이터베이스
├── public/
│   └── static/            # 정적 파일 (아이콘, CSS 등)
├── migrations/            # D1 마이그레이션 (Cloudflare용)
├── package.json
├── ecosystem.config.cjs   # PM2 설정
├── tsconfig.json
└── README.md
```

## 🌟 주요 기능

### 사용자 기능
- ✅ 반응형 랜딩 페이지
- ✅ 지원서 제출 폼
- ✅ 실시간 폼 검증
- ✅ 제출 확인 메시지

### 관리자 기능
- ✅ 로그인 시스템
- ✅ 실시간 통계 대시보드
- ✅ 지원서 목록 및 검색
- ✅ 필터링 (상태, 유형)
- ✅ 지원서 상세 보기
- ✅ 상태 변경 (승인/거절/대기)

## 🆘 문제 해결

### 포트가 이미 사용 중인 경우
```bash
# 포트 3000을 사용하는 프로세스 종료
sudo lsof -ti:3000 | xargs kill -9

# 또는
sudo fuser -k 3000/tcp
```

### PM2 프로세스가 계속 재시작하는 경우
```bash
# 로그 확인
pm2 logs ygsc-beauty --lines 50

# 프로세스 삭제 후 재시작
pm2 delete ygsc-beauty
pm2 start ecosystem.config.cjs
```

### 데이터베이스가 잠긴 경우
```bash
# 데이터베이스 재설정
pm2 stop ygsc-beauty
rm -f data/ygsc.db-shm data/ygsc.db-wal
pm2 start ygsc-beauty
```

## 📞 문의

- **이메일**: ygsc_beauty@startup.com
- **카카오톡**: 카카오톡 채널 'YGSC'

## 📄 라이선스

© 2026 YGSC. All rights reserved.

---

## 🎯 다음 단계

1. ✅ ~~자체 서버 구축~~ (완료!)
2. 🔜 이메일 알림 시스템
3. 🔜 파일 업로드 기능
4. 🔜 데이터 엑셀 내보내기
5. 🔜 고급 통계 및 차트
