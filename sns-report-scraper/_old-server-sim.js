// "옛날 서버 + 새 화면" 상황 재현: /api/brands 가 없는 서버로 새 index.html을 서빙
const express = require('express');
const path = require('path');
const app = express();
app.use(express.static(path.join(__dirname, 'web/public')));
app.get('/api/status', (req, res) => res.json({ hasTwitterSession: false, hasInstagramSession: false }));
app.get('/api/reports', (req, res) => res.json([]));
app.listen(4849, () => console.log('옛 서버 시뮬레이터 :4849'));
