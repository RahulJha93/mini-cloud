# 01 - Single Backend Server

## Goal
Test how a single Node.js server handles concurrent users using k6 load testing.

---

## Setup

### 1. Express Server (`index.js`)

```javascript
const express = require('express');
const app = express();
const PORT = process.env.PORT || 9000;

app.use(express.json());

let users = [
  { id: 1, name: 'John Doe', email: 'john@example.com' },
  { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
];

// GET /health - Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// GET /users - Get all users
app.get('/users', async (req, res) => {
  res.status(200).json({
    success: true,
    time: Date.now(),
    count: users.length,
    data: users
  });
});

// POST /users - Create a new user
app.post('/users', (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) {
    return res.status(400).json({ success: false, message: 'Please provide name and email' });
  }
  const newUser = { id: users.length + 1, name, email };
  users.push(newUser);
  res.status(201).json({ success: true, message: 'User created successfully', data: newUser });
});

// GET /compute - Simulate CPU-intensive task
app.get('/compute', (req, res) => {
  let total = 0;
  for (let i = 0; i < 1e7; i++) { total += i; }
  res.json({ success: true, total });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
```

### 2. Dockerfile

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 9000
CMD ["node", "index.js"]
```

### 3. k6 Load Test (`baseline.js`)

```javascript
import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  vus: 50,           // changed for each test: 50, 100, 300
  duration: '30s',
};

export default function () {
  http.get('http://localhost:9000/users');
  sleep(1);
}
```

---

## Experiment Results

### Test 1: 50 VUs for 30s ✅

```
█ TOTAL RESULTS

  HTTP
  http_req_duration..: avg=6.25ms   min=443.9µs  med=1.84ms   max=128.48ms  p(90)=5.29ms   p(95)=15.67ms
  http_req_failed....: 0.00%   0 out of 1500
  http_reqs..........: 1500    49.609353/s

  EXECUTION
  iterations.........: 1500    49.609353/s
  vus................: 50      min=50       max=50
```

**Result:** All 1500 requests successful, ~50 req/s

---

### Test 2: 100 VUs for 30s ✅

```
█ TOTAL RESULTS

  HTTP
  http_req_duration..: avg=6.52ms   min=395µs    med=2.09ms   max=150.77ms  p(90)=8.97ms   p(95)=15.35ms
  http_req_failed....: 0.00%   0 out of 3000
  http_reqs..........: 3000    99.072152/s

  EXECUTION
  iterations.........: 3000    99.072152/s
  vus................: 100     min=100      max=100
```

**Result:** All 3000 requests successful, ~99 req/s

---

### Test 3: 300 VUs for 30s ❌ (Connection Errors!)

```
WARN[0000] Request Failed    error="dial tcp 127.0.0.1:9000: connectex: No connection 
                             could be made because the target machine actively refused it."
WARN[0000] Request Failed    error="dial tcp 127.0.0.1:9000: connectex: No connection 
                             could be made because the target machine actively refused it."
... (many more errors)
```

```
█ TOTAL RESULTS

  HTTP
  http_req_duration..: avg=7.45ms   min=0s       med=1.22ms   max=216.23ms  p(90)=7.23ms   p(95)=15.15ms
  http_req_failed....: 1.05%   95 out of 9000
  http_reqs..........: 9000    296.754761/s

  EXECUTION
  iterations.........: 9000    296.754761/s
  vus................: 300     min=300      max=300
```

**Result:** 95 requests failed (1.05%), TCP connection refused errors

---

## Summary Table

| VUs | Duration | Total Requests | Failed | Req/s | Avg Latency | Status |
|-----|----------|----------------|--------|-------|-------------|--------|
| 50  | 30s      | 1,500          | 0      | ~50   | 6.25ms      | ✅ Pass |
| 100 | 30s      | 3,000          | 0      | ~99   | 6.52ms      | ✅ Pass |
| 300 | 30s      | 9,000          | 95     | ~297  | 7.45ms      | ❌ Errors |

---

## What Happened at 300 VUs?

```
Error: "dial tcp 127.0.0.1:9000: connectex: No connection could be made 
        because the target machine actively refused it."
```

### The Problem Visualized

```
┌─────────────────┐
│    300 VUs      │
│   (k6 test)     │
└────────┬────────┘
         │ 300 simultaneous connections
         ▼
┌─────────────────┐
│  Single Node.js │  ← TCP backlog queue fills up (~128 default)
│     Server      │  ← Can't accept all connections at once
│   (port 9000)   │  ← Some connections get REFUSED
└─────────────────┘
         │
         ▼
    "Connection Refused" for overflow requests
```

### Why This Happens

1. **TCP Backlog Limit** - OS has a queue for pending connections (default ~128-511)
2. **Single Process** - Node.js is single-threaded, processes requests sequentially
3. **No Horizontal Scaling** - Only 1 server instance handling everything
4. **Burst Traffic** - 300 connections hitting at once overwhelms the queue

---

## Key Learnings

1. **Single server has limits** - Works fine up to ~100-200 concurrent users
2. **TCP backlog** - OS-level queue for pending connections has a limit
3. **Graceful degradation** - Only 1.05% failed, server handled most requests
4. **Need scaling** - To reliably handle 300+ users, need multiple instances

---

## Commands Used

```bash
# Build Docker image
docker build -t single-backend .

# Run single container
docker run -p 9000:9000 single-backend

# Run k6 tests (modify vus in baseline.js each time)
k6 run baseline.js
```

---

## Next: 02 - Load Balancing with Nginx

**Solution:** Scale horizontally with multiple containers behind Nginx load balancer.

```
┌─────────────────┐
│    300 VUs      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│      Nginx      │  ← Distributes load
│  Load Balancer  │
└────────┬────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
  App1  App2  App3   ← 3 instances = 3x capacity
```