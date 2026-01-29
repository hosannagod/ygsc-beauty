import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import Database from 'better-sqlite3'
import { getAdminDashboardHTML, getAdminLoginHTML } from './src/admin.tsx'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Initialize SQLite database
const db = new Database(join(__dirname, 'data/ygsc.db'))

// Create tables if not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT NOT NULL,
    type TEXT NOT NULL,
    payment TEXT NOT NULL,
    funding TEXT NOT NULL,
    motivation TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_applications_email ON applications(email);
  CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
  CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications(created_at);

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  INSERT OR IGNORE INTO admin_users (id, username, password_hash, email) VALUES 
    (1, 'admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'admin@ygsc.com');
`)

const app = new Hono()

// Enable CORS for API routes
app.use('/api/*', cors())

// Serve static files from public directory
app.use('/static/*', serveStatic({ root: './public' }))

// Admin authentication middleware
const adminAuth = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  
  const token = authHeader.substring(7)
  // Simple token validation (in production, use JWT)
  if (token !== 'admin-token-ygsc-2026') {
    return c.json({ error: 'Invalid token' }, 401)
  }
  
  await next()
}

// API endpoint for application submission
app.post('/api/apply', async (c) => {
  try {
    const data = await c.req.json()
    const { name, phone, email, company, type, payment, funding, motivation } = data
    
    // Validate required fields
    if (!name || !phone || !email || !company || !type || !payment || !funding || !motivation) {
      return c.json({ 
        success: false, 
        message: '모든 필수 항목을 입력해주세요.' 
      }, 400)
    }
    
    // Save to database
    const stmt = db.prepare(`
      INSERT INTO applications (name, phone, email, company, type, payment, funding, motivation, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `)
    const result = stmt.run(name, phone, email, company, type, payment, funding, motivation)
    
    console.log('New application saved:', result.lastInsertRowid)
    
    return c.json({ 
      success: true, 
      message: '지원서가 성공적으로 제출되었습니다. 빠른 시일 내에 연락드리겠습니다.',
      id: result.lastInsertRowid
    })
  } catch (error) {
    console.error('Error saving application:', error)
    return c.json({ 
      success: false, 
      message: '지원서 제출 중 오류가 발생했습니다. 다시 시도해주세요.' 
    }, 500)
  }
})

// Admin login
app.post('/api/admin/login', async (c) => {
  try {
    const { username, password } = await c.req.json()
    
    // Simple authentication (in production, use proper password hashing)
    if (username === 'admin' && password === 'admin123') {
      return c.json({
        success: true,
        token: 'admin-token-ygsc-2026'
      })
    }
    
    return c.json({ success: false, error: 'Invalid credentials' }, 401)
  } catch (error) {
    return c.json({ success: false, error: 'Login failed' }, 500)
  }
})

// Admin get all applications
app.get('/api/admin/applications', adminAuth, async (c) => {
  try {
    const status = c.req.query('status')
    const type = c.req.query('type')
    const search = c.req.query('search')
    
    let query = 'SELECT * FROM applications WHERE 1=1'
    const params: any[] = []
    
    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }
    
    if (type) {
      query += ' AND type = ?'
      params.push(type)
    }
    
    if (search) {
      query += ' AND (company LIKE ? OR name LIKE ? OR email LIKE ?)'
      const searchParam = `%${search}%`
      params.push(searchParam, searchParam, searchParam)
    }
    
    query += ' ORDER BY created_at DESC'
    
    const stmt = db.prepare(query)
    const applications = stmt.all(...params)
    
    // Get stats
    const statsStmt = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
      FROM applications
    `)
    const stats = statsStmt.get()
    
    return c.json({
      applications,
      stats
    })
  } catch (error) {
    console.error('Error fetching applications:', error)
    return c.json({ error: 'Failed to fetch applications' }, 500)
  }
})

// Admin get single application
app.get('/api/admin/applications/:id', adminAuth, async (c) => {
  try {
    const id = c.req.param('id')
    const stmt = db.prepare('SELECT * FROM applications WHERE id = ?')
    const result = stmt.get(id)
    
    if (!result) {
      return c.json({ error: 'Application not found' }, 404)
    }
    
    return c.json(result)
  } catch (error) {
    return c.json({ error: 'Failed to fetch application' }, 500)
  }
})

// Admin update application status
app.put('/api/admin/applications/:id', adminAuth, async (c) => {
  try {
    const id = c.req.param('id')
    const { status } = await c.req.json()
    
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return c.json({ error: 'Invalid status' }, 400)
    }
    
    const stmt = db.prepare('UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    stmt.run(status, id)
    
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: 'Failed to update application' }, 500)
  }
})

// Admin routes
app.get('/admin/login', (c) => {
  return c.html(getAdminLoginHTML())
})

app.get('/admin', (c) => {
  return c.html(getAdminDashboardHTML())
})

// Main page - load from dist or serve inline
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>YGSC Beauty Build-up Platform | K-뷰티 글로벌 확장 파트너</title>
        <meta name="description" content="검증된 파트너십을 통해 K-뷰티 스타트업의 글로벌 매출을 확정하고 실행하는 전문 빌더 플랫폼">
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap');
            
            * {
                font-family: 'Noto Sans KR', sans-serif;
            }
            
            .gradient-gold {
                background: linear-gradient(135deg, #D4AF37 0%, #F4E5C3 50%, #D4AF37 100%);
            }
            
            .text-gold {
                color: #D4AF37;
            }
            
            .border-gold {
                border-color: #D4AF37;
            }
            
            .hover-gold:hover {
                background-color: #D4AF37;
                color: white;
            }
            
            .section-divider {
                height: 2px;
                background: linear-gradient(90deg, transparent, #D4AF37, transparent);
            }
            
            .animate-fade-in {
                animation: fadeIn 1s ease-in;
            }
            
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            .card-hover {
                transition: all 0.3s ease;
            }
            
            .card-hover:hover {
                transform: translateY(-5px);
                box-shadow: 0 20px 40px rgba(212, 175, 55, 0.2);
            }
            
            .btn-primary {
                background: linear-gradient(135deg, #D4AF37 0%, #F4E5C3 50%, #D4AF37 100%);
                background-size: 200% auto;
                transition: all 0.3s ease;
            }
            
            .btn-primary:hover {
                background-position: right center;
                transform: scale(1.05);
                box-shadow: 0 10px 30px rgba(212, 175, 55, 0.4);
            }
        </style>
    </head>
    <body class="bg-white">
        <!-- Navigation -->
        <nav class="fixed w-full bg-white/95 backdrop-blur-sm shadow-sm z-50">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex justify-between items-center h-20">
                    <div class="flex items-center space-x-2">
                        <i class="fas fa-gem text-gold text-3xl"></i>
                        <span class="text-2xl font-bold text-gray-900">YGSC</span>
                        <span class="text-sm text-gray-500 hidden sm:inline">Beauty Build-up Platform</span>
                    </div>
                    <div class="flex items-center space-x-8">
                        <a href="#overview" class="text-gray-600 hover:text-gold transition">개요</a>
                        <a href="#benefits" class="text-gray-600 hover:text-gold transition">혜택</a>
                        <a href="#apply" class="text-gray-600 hover:text-gold transition">지원하기</a>
                        <a href="#contact" class="text-gray-600 hover:text-gold transition">문의</a>
                        <a href="/admin/login" class="text-gold hover:text-gold/80 transition font-medium">
                            <i class="fas fa-user-shield mr-1"></i>ADMIN
                        </a>
                    </div>
                </div>
            </div>
        </nav>

        <!-- Hero Section -->
        <section class="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
            <div class="max-w-7xl mx-auto text-center animate-fade-in">
                <div class="mb-8">
                    <span class="inline-block px-6 py-2 bg-gold/10 text-gold rounded-full text-sm font-medium mb-6">
                        2026년 1기 모집 중
                    </span>
                </div>
                <h1 class="text-5xl sm:text-6xl lg:text-7xl font-black text-gray-900 mb-6 leading-tight">
                    Partnering with the<br/>
                    <span class="text-gold">Next K-Beauty Leader</span>
                </h1>
                <p class="text-xl sm:text-2xl text-gray-600 mb-12 max-w-3xl mx-auto font-light">
                    검증된 파트너십을 통해 K-뷰티 스타트업의<br/>
                    글로벌 매출을 확정하고 실행하는 전문 빌더 플랫폼
                </p>
                <div class="flex flex-col sm:flex-row gap-4 justify-center">
                    <a href="#apply" class="btn-primary px-10 py-4 text-white text-lg font-bold rounded-full inline-flex items-center justify-center">
                        <i class="fas fa-rocket mr-2"></i>
                        지금 지원하기
                    </a>
                    <a href="#overview" class="px-10 py-4 bg-white border-2 border-gray-300 text-gray-800 text-lg font-bold rounded-full hover-gold transition">
                        자세히 알아보기
                    </a>
                </div>
                
                <!-- Stats -->
                <div class="mt-20 grid grid-cols-1 sm:grid-cols-3 gap-8">
                    <div class="p-6">
                        <div class="text-4xl font-black text-gold mb-2">10개</div>
                        <div class="text-gray-600">선발 기업</div>
                    </div>
                    <div class="p-6">
                        <div class="text-4xl font-black text-gold mb-2">6개월</div>
                        <div class="text-gray-600">무제한 라이브 방송</div>
                    </div>
                    <div class="p-6">
                        <div class="text-4xl font-black text-gold mb-2">7억+</div>
                        <div class="text-gray-600">TIPS 연계 지원</div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Divider -->
        <div class="section-divider max-w-4xl mx-auto"></div>

        <!-- Overview Section -->
        <section id="overview" class="py-20 px-4 sm:px-6 lg:px-8">
            <div class="max-w-7xl mx-auto">
                <div class="text-center mb-16">
                    <h2 class="text-4xl sm:text-5xl font-black text-gray-900 mb-4">모집 개요</h2>
                    <p class="text-lg text-gray-600">2026년 상반기, 글로벌 시장의 주인공이 될 YGSC 1기 참여 기업을 선별 모집합니다</p>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
                    <!-- 모집 기간 -->
                    <div class="bg-gray-50 p-8 rounded-2xl card-hover">
                        <div class="flex items-center mb-4">
                            <i class="fas fa-calendar-alt text-gold text-3xl mr-4"></i>
                            <h3 class="text-2xl font-bold text-gray-900">모집 기간</h3>
                        </div>
                        <p class="text-lg text-gray-700 font-medium">
                            2026년 2월 1일(일) ~ 2월 28일(토) 23:59
                        </p>
                    </div>

                    <!-- 모집 규모 -->
                    <div class="bg-gray-50 p-8 rounded-2xl card-hover">
                        <div class="flex items-center mb-4">
                            <i class="fas fa-users text-gold text-3xl mr-4"></i>
                            <h3 class="text-2xl font-bold text-gray-900">모집 규모</h3>
                        </div>
                        <p class="text-lg text-gray-700 font-medium">
                            최대 10개 기업 (선착순 아님, 선별 심사)
                        </p>
                    </div>
                </div>

                <!-- 모집 대상 -->
                <div class="bg-white border-2 border-gold/30 rounded-2xl p-8 mb-8">
                    <h3 class="text-2xl font-bold text-gray-900 mb-6 flex items-center">
                        <i class="fas fa-bullseye text-gold mr-3"></i>
                        모집 대상
                    </h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div class="border-l-4 border-gold pl-6">
                            <h4 class="text-xl font-bold text-gray-800 mb-3">신규 빌드업</h4>
                            <p class="text-gray-600 leading-relaxed">
                                아이디어는 있으나 제조 및 판로가 막막한 예비/초기 창업자
                            </p>
                        </div>
                        <div class="border-l-4 border-gold pl-6">
                            <h4 class="text-xl font-bold text-gray-800 mb-3">재고 스케일업</h4>
                            <p class="text-gray-600 leading-relaxed">
                                이미 제품이 있으며, 빠른 재고 소진 및 글로벌 확장이 필요한 기업
                            </p>
                        </div>
                    </div>
                    <div class="mt-6 p-4 bg-gold/5 rounded-lg">
                        <p class="text-gray-700">
                            <i class="fas fa-check-circle text-gold mr-2"></i>
                            <strong>공통 조건:</strong> 자부담금 3,000만 원 확보를 통해 사업 의지가 검증된 법인 또는 개인
                        </p>
                    </div>
                </div>
            </div>
        </section>

        <!-- Divider -->
        <div class="section-divider max-w-4xl mx-auto"></div>

        <!-- Benefits Section -->
        <section id="benefits" class="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
            <div class="max-w-7xl mx-auto">
                <div class="text-center mb-16">
                    <h2 class="text-4xl sm:text-5xl font-black text-gray-900 mb-4">YGSC 1기 독점 혜택</h2>
                    <p class="text-lg text-gray-600">조언에 그치지 않습니다. 당신의 브랜드를 전 세계 화장대 위에 물리적으로 올립니다.</p>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <!-- Benefit 1 -->
                    <div class="bg-white rounded-2xl p-8 card-hover border-2 border-transparent hover:border-gold/30">
                        <div class="flex items-start mb-6">
                            <div class="w-14 h-14 rounded-full gradient-gold flex items-center justify-center text-white font-black text-xl mr-4 flex-shrink-0">
                                1
                            </div>
                            <div>
                                <h3 class="text-2xl font-bold text-gray-900 mb-2">6개월 무제한 왕홍 라이브 방송</h3>
                                <p class="text-gold font-medium">Global Sales</p>
                            </div>
                        </div>
                        <ul class="space-y-3 text-gray-700">
                            <li class="flex items-start">
                                <i class="fas fa-broadcast-tower text-gold mt-1 mr-3"></i>
                                <span>아이콴(IQUAN) 그룹 소속 상위 1% 왕홍 매칭</span>
                            </li>
                            <li class="flex items-start">
                                <i class="fas fa-mobile-alt text-gold mt-1 mr-3"></i>
                                <span>중국 틱톡(Douyin) 라이브 무제한 지원</span>
                            </li>
                            <li class="flex items-start">
                                <i class="fas fa-rocket text-gold mt-1 mr-3"></i>
                                <span>재고 소진 시까지 멈추지 않는 공격적인 글로벌 세일즈 가동</span>
                            </li>
                        </ul>
                    </div>

                    <!-- Benefit 2 -->
                    <div class="bg-white rounded-2xl p-8 card-hover border-2 border-transparent hover:border-gold/30">
                        <div class="flex items-start mb-6">
                            <div class="w-14 h-14 rounded-full gradient-gold flex items-center justify-center text-white font-black text-xl mr-4 flex-shrink-0">
                                2
                            </div>
                            <div>
                                <h3 class="text-2xl font-bold text-gray-900 mb-2">올인원 전문가 바우처</h3>
                                <p class="text-gold font-medium">Professional Support</p>
                            </div>
                        </div>
                        <ul class="space-y-3 text-gray-700">
                            <li class="flex items-start">
                                <i class="fas fa-calculator text-gold mt-1 mr-3"></i>
                                <span><strong>회계/세무:</strong> 법인 설립부터 매출 관리, 재무 실사 대비 토탈 케어</span>
                            </li>
                            <li class="flex items-start">
                                <i class="fas fa-gavel text-gold mt-1 mr-3"></i>
                                <span><strong>법률/특허:</strong> 화장품 원료 배합 특허권 확보 및 글로벌 상표권 보호 전략</span>
                            </li>
                            <li class="flex items-start">
                                <i class="fas fa-ticket-alt text-gold mt-1 mr-3"></i>
                                <span><strong>바우처 혜택:</strong> 파트너 변리사, 회계사, 변호사 협업 시 YGSC 전용 바우처 지원</span>
                            </li>
                        </ul>
                    </div>

                    <!-- Benefit 3 -->
                    <div class="bg-white rounded-2xl p-8 card-hover border-2 border-transparent hover:border-gold/30">
                        <div class="flex items-start mb-6">
                            <div class="w-14 h-14 rounded-full gradient-gold flex items-center justify-center text-white font-black text-xl mr-4 flex-shrink-0">
                                3
                            </div>
                            <div>
                                <h3 class="text-2xl font-bold text-gray-900 mb-2">제조사 및 자금 프리패스</h3>
                                <p class="text-gold font-medium">Build-up & Finance</p>
                            </div>
                        </div>
                        <ul class="space-y-3 text-gray-700">
                            <li class="flex items-start">
                                <i class="fas fa-industry text-gold mt-1 mr-3"></i>
                                <span>(주)서호랩(제조), 뉴프렌즈(패키지) 등 특화 제조사 Pool 우선 매칭</span>
                            </li>
                            <li class="flex items-start">
                                <i class="fas fa-chalkboard-teacher text-gold mt-1 mr-3"></i>
                                <span>청년창업사관학교 교수진의 1:1 코칭</span>
                            </li>
                            <li class="flex items-start">
                                <i class="fas fa-hand-holding-usd text-gold mt-1 mr-3"></i>
                                <span>정부지원금 & 정책 융자 로드맵 설계</span>
                            </li>
                        </ul>
                    </div>

                    <!-- Benefit 4 -->
                    <div class="bg-white rounded-2xl p-8 card-hover border-2 border-transparent hover:border-gold/30">
                        <div class="flex items-start mb-6">
                            <div class="w-14 h-14 rounded-full gradient-gold flex items-center justify-center text-white font-black text-xl mr-4 flex-shrink-0">
                                4
                            </div>
                            <div>
                                <h3 class="text-2xl font-bold text-gray-900 mb-2">팁스(TIPS) 연계 및 직접 투자</h3>
                                <p class="text-gold font-medium">Investment</p>
                            </div>
                        </div>
                        <ul class="space-y-3 text-gray-700">
                            <li class="flex items-start">
                                <i class="fas fa-chart-line text-gold mt-1 mr-3"></i>
                                <span>월간 매출 데이터 기반 기업가치 스케일업</span>
                            </li>
                            <li class="flex items-start">
                                <i class="fas fa-handshake text-gold mt-1 mr-3"></i>
                                <span>직접 투자 검토</span>
                            </li>
                            <li class="flex items-start">
                                <i class="fas fa-coins text-gold mt-1 mr-3"></i>
                                <span>TIPS 추천을 통한 최대 7억 원 이상의 R&D 자금 확보 지원</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </section>

        <!-- Divider -->
        <div class="section-divider max-w-4xl mx-auto"></div>

        <!-- Application Section -->
        <section id="apply" class="py-20 px-4 sm:px-6 lg:px-8">
            <div class="max-w-3xl mx-auto">
                <div class="text-center mb-12">
                    <h2 class="text-4xl sm:text-5xl font-black text-gray-900 mb-4">지원 방법</h2>
                    <p class="text-lg text-gray-600">지금 바로 YGSC 1기에 지원하세요</p>
                </div>

                <!-- Payment Options -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
                    <div class="bg-gradient-to-br from-gold/10 to-white border-2 border-gold rounded-2xl p-8 text-center">
                        <i class="fas fa-money-bill-wave text-gold text-4xl mb-4"></i>
                        <h3 class="text-2xl font-bold text-gray-900 mb-3">선택 1: Cash</h3>
                        <p class="text-3xl font-black text-gold mb-2">1,000만 원</p>
                        <p class="text-gray-600">멤버십 비용 납부</p>
                    </div>
                    <div class="bg-gradient-to-br from-gold/10 to-white border-2 border-gold rounded-2xl p-8 text-center">
                        <i class="fas fa-chart-pie text-gold text-4xl mb-4"></i>
                        <h3 class="text-2xl font-bold text-gray-900 mb-3">선택 2: Equity</h3>
                        <p class="text-3xl font-black text-gold mb-2">지분 5%</p>
                        <p class="text-gray-600">현금 부담 없이 기업 지분 부여</p>
                    </div>
                </div>

                <!-- Application Form -->
                <div class="bg-white border-2 border-gray-200 rounded-2xl p-8">
                    <h3 class="text-2xl font-bold text-gray-900 mb-6">1기 신청 대시보드</h3>
                    <form id="applicationForm" class="space-y-6">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label class="block text-gray-700 font-medium mb-2">대표자명 *</label>
                                <input type="text" name="name" required class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-gold focus:outline-none transition">
                            </div>
                            <div>
                                <label class="block text-gray-700 font-medium mb-2">연락처 *</label>
                                <input type="tel" name="phone" required class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-gold focus:outline-none transition">
                            </div>
                        </div>

                        <div>
                            <label class="block text-gray-700 font-medium mb-2">이메일 *</label>
                            <input type="email" name="email" required class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-gold focus:outline-none transition">
                        </div>

                        <div>
                            <label class="block text-gray-700 font-medium mb-2">기업/브랜드명 *</label>
                            <input type="text" name="company" required class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-gold focus:outline-none transition">
                        </div>

                        <div>
                            <label class="block text-gray-700 font-medium mb-2">기업 유형 *</label>
                            <select name="type" required class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-gold focus:outline-none transition">
                                <option value="">선택해주세요</option>
                                <option value="신규 빌드업">신규 빌드업 (아이디어 단계)</option>
                                <option value="재고 스케일업">재고 스케일업 (제품 보유)</option>
                            </select>
                        </div>

                        <div>
                            <label class="block text-gray-700 font-medium mb-2">결제 방식 *</label>
                            <select name="payment" required class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-gold focus:outline-none transition">
                                <option value="">선택해주세요</option>
                                <option value="Cash">Cash (1,000만 원)</option>
                                <option value="Equity">Equity (지분 5%)</option>
                            </select>
                        </div>

                        <div>
                            <label class="block text-gray-700 font-medium mb-2">자부담금 확보 여부 *</label>
                            <select name="funding" required class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-gold focus:outline-none transition">
                                <option value="">선택해주세요</option>
                                <option value="예">예 (3,000만 원 확보)</option>
                                <option value="준비 중">준비 중</option>
                            </select>
                        </div>

                        <div>
                            <label class="block text-gray-700 font-medium mb-2">지원 동기 및 사업 계획 *</label>
                            <textarea name="motivation" required rows="6" class="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-gold focus:outline-none transition" placeholder="YGSC 1기에 지원하시는 이유와 사업 계획을 자유롭게 작성해주세요."></textarea>
                        </div>

                        <div class="flex items-start">
                            <input type="checkbox" id="agree" required class="mt-1 mr-3">
                            <label for="agree" class="text-sm text-gray-600">
                                개인정보 수집 및 이용에 동의합니다. (필수)
                            </label>
                        </div>

                        <button type="submit" class="w-full btn-primary py-4 text-white text-lg font-bold rounded-full flex items-center justify-center">
                            <i class="fas fa-paper-plane mr-2"></i>
                            지원서 제출하기
                        </button>

                        <div id="message" class="hidden mt-4 p-4 rounded-lg"></div>
                    </form>
                </div>
            </div>
        </section>

        <!-- Divider -->
        <div class="section-divider max-w-4xl mx-auto"></div>

        <!-- Contact Section -->
        <section id="contact" class="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
            <div class="max-w-4xl mx-auto text-center">
                <h2 class="text-4xl sm:text-5xl font-black text-gray-900 mb-8">문의하기</h2>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
                    <div class="bg-white rounded-2xl p-8 card-hover">
                        <i class="fas fa-envelope text-gold text-4xl mb-4"></i>
                        <h3 class="text-xl font-bold text-gray-900 mb-2">이메일</h3>
                        <a href="mailto:ygsc_beauty@startup.com" class="text-gold hover:underline">
                            ygsc_beauty@startup.com
                        </a>
                    </div>
                    <div class="bg-white rounded-2xl p-8 card-hover">
                        <i class="fas fa-comment text-gold text-4xl mb-4"></i>
                        <h3 class="text-xl font-bold text-gray-900 mb-2">카카오톡</h3>
                        <p class="text-gray-700">카카오톡 채널 'YGSC'</p>
                    </div>
                </div>

                <div class="bg-gradient-to-r from-gold/10 via-gold/5 to-gold/10 rounded-2xl p-12">
                    <p class="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">
                        "YGSC는 조언에 그치지 않습니다."
                    </p>
                    <p class="text-xl text-gray-700">
                        우리는 당신의 브랜드를 전 세계 화장대 위에 물리적으로 올립니다.
                    </p>
                </div>
            </div>
        </section>

        <!-- Footer -->
        <footer class="bg-gray-900 text-white py-12 px-4 sm:px-6 lg:px-8">
            <div class="max-w-7xl mx-auto text-center">
                <div class="flex items-center justify-center space-x-2 mb-6">
                    <i class="fas fa-gem text-gold text-3xl"></i>
                    <span class="text-2xl font-bold">YGSC</span>
                </div>
                <p class="text-gray-400 mb-4">
                    Young Global Startup Community<br/>
                    Beauty Build-up Platform
                </p>
                <div class="mb-4">
                    <a href="/admin/login" class="text-gold hover:text-gold/80 transition text-sm">
                        <i class="fas fa-user-shield mr-1"></i>관리자 로그인
                    </a>
                </div>
                <p class="text-gray-500 text-sm">
                    © 2026 YGSC. All rights reserved.
                </p>
            </div>
        </footer>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
            // Smooth scroll
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener('click', function (e) {
                    e.preventDefault();
                    const target = document.querySelector(this.getAttribute('href'));
                    if (target) {
                        const offsetTop = target.offsetTop - 80;
                        window.scrollTo({
                            top: offsetTop,
                            behavior: 'smooth'
                        });
                    }
                });
            });

            // Form submission
            document.getElementById('applicationForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const formData = new FormData(e.target);
                const data = Object.fromEntries(formData.entries());
                
                const messageDiv = document.getElementById('message');
                messageDiv.classList.remove('hidden', 'bg-green-100', 'bg-red-100', 'text-green-800', 'text-red-800');
                messageDiv.textContent = '제출 중...';
                messageDiv.classList.add('bg-gray-100', 'text-gray-800');
                
                try {
                    const response = await axios.post('/api/apply', data);
                    
                    if (response.data.success) {
                        messageDiv.classList.remove('bg-gray-100', 'text-gray-800');
                        messageDiv.classList.add('bg-green-100', 'text-green-800');
                        messageDiv.innerHTML = '<i class="fas fa-check-circle mr-2"></i>' + response.data.message;
                        e.target.reset();
                        
                        setTimeout(() => {
                            messageDiv.classList.add('hidden');
                        }, 5000);
                    } else {
                        throw new Error(response.data.message);
                    }
                } catch (error) {
                    messageDiv.classList.remove('bg-gray-100', 'text-gray-800');
                    messageDiv.classList.add('bg-red-100', 'text-red-800');
                    messageDiv.innerHTML = '<i class="fas fa-exclamation-circle mr-2"></i>' + (error.response?.data?.message || error.message);
                }
            });

            // Fade in on scroll
            const observerOptions = {
                threshold: 0.1,
                rootMargin: '0px 0px -50px 0px'
            };

            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('animate-fade-in');
                    }
                });
            }, observerOptions);

            document.querySelectorAll('.card-hover').forEach(el => observer.observe(el));
        </script>
    </body>
    </html>
  `)
})

export default app

// Start server
const port = Number(process.env.PORT) || 3000
console.log(`🚀 YGSC Beauty Platform starting on port ${port}...`)

serve({
  fetch: app.fetch,
  port
})

console.log(`✨ Server running at http://localhost:${port}`)
console.log(`📊 Admin dashboard: http://localhost:${port}/admin/login`)
console.log(`🔑 Admin credentials: admin / admin123`)
