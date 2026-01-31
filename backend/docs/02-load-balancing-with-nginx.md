# 02 - Load Balancing with Nginx

## Goal
Scale horizontally using multiple server instances behind an Nginx load balancer to handle more concurrent users.

---

## Architecture

```
┌─────────────────┐
│    Clients      │
│   (k6 - 30 VUs) │
└────────┬────────┘
         │ Port 8080
         ▼
┌─────────────────┐
│      Nginx      │  ← Load Balancer (Round Robin)
│   (port 80)     │
└────────┬────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
┌──────┐ ┌──────┐ ┌──────┐
│ App1 │ │ App2 │ │ App3 │   ← 3 Node.js instances
│:3000 │ │:3000 │ │:3000 │
└──────┘ └──────┘ └──────┘
```

---

## Setup

### 1. Express Server (`index.js`)

Same server from 01, but now with `SERVER_NAME` environment variable to identify which instance handled the request:

```javascript
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let users = [
  { id: 1, name: 'John Doe', email: 'john@example.com' },
  { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
];

// GET /users - Returns which server handled the request
app.get('/users', async (req, res) => {
  res.status(200).json({
    success: true,
    server: process.env.SERVER_NAME,  // ← Identifies the instance
    time: Date.now(),
    count: users.length,
    data: users
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
```

---

### 2. Nginx Configuration (`nginx/nginx.conf`)

```nginx
events {}

http {
  # Define upstream servers (backend pool)
  upstream backend {
    server app1:3000;
    server app2:3000;
    server app3:3000;
  }

  server {
    listen 80;

    location / {
      proxy_pass http://backend;          # Forward to upstream
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
    }
  }
}
```

**Key Concepts:**
- `upstream backend` - Defines a pool of servers
- Default algorithm: **Round Robin** (distributes requests evenly)
- `proxy_pass http://backend` - Forwards requests to the pool

---

### 3. Docker Compose (`docker-compose.yml`)

```yaml
services:
  app1:
    build: .
    image: users-api
    environment:
      SERVER_NAME: app1    # ← Identifies this instance

  app2:
    build: .
    image: users-api
    environment:
      SERVER_NAME: app2

  app3:
    build: .
    image: users-api
    environment:
      SERVER_NAME: app3

  nginx:
    image: nginx:alpine
    container_name: nginx
    ports:
      - "8080:80"          # ← Exposed to host
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - app1
      - app2
      - app3
```

---

### 4. k6 Load Test with Counters (`baseline.js`)

Track which server handles each request:

```javascript
import http from 'k6/http';
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';

// Create counters for each server
const app1Counter = new Counter('app1_requests');
const app2Counter = new Counter('app2_requests');
const app3Counter = new Counter('app3_requests');

export const options = {
  vus: 30,
  duration: '10s',
};

export default function () {
  const res = http.get('http://localhost:8080/users');  // ← Hit Nginx

  const body = JSON.parse(res.body);
  const server = body.server;
 
  // Increment the appropriate counter
  if (server === 'app1') app1Counter.add(1);
  else if (server === 'app2') app2Counter.add(1);
  else if (server === 'app3') app3Counter.add(1);

  sleep(1);
}
```

---

## Experiment 1: Round Robin Distribution

### Test: 30 VUs for 10s

```bash
docker compose up --build
k6 run baseline.js
```

### Result

```
█ TOTAL RESULTS

  CUSTOM
  app1_requests..................: 30     
  app2_requests..................: 30     
  app3_requests..................: 29     

  HTTP
  http_req_failed................: 0.00%   0 out of 89
```

**Distribution:** ~33% each server (Round Robin working!)

```
Request Distribution:
┌────────┬──────────┬─────────┐
│ Server │ Requests │ Percent │
├────────┼──────────┼─────────┤
│ app1   │    30    │  33.7%  │
│ app2   │    30    │  33.7%  │
│ app3   │    29    │  32.6%  │
└────────┴──────────┴─────────┘
```

---

## Experiment 2: Simulating a Slow Server

### What if one server is slow?

Added artificial delay to `app2`:

```javascript
// GET /users - Get all users
app.get('/users', async (req, res) => {
  // Make ONLY app2 slow
  if (process.env.SERVER_NAME === 'app2') {
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
  }

  res.status(200).json({
    success: true,
    server: process.env.SERVER_NAME,
    time: Date.now(),
    data: users
  });
});
```

### Problem with Round Robin

With default Round Robin, Nginx **doesn't know** app2 is slow. It still sends 1/3 of traffic there!

```
Request flow with slow app2:
─────────────────────────────
app1: ──●──●──●──●──●──  (fast, 5ms each)
app2: ──────●──────────●  (slow, 1000ms each)  ← Bottleneck!
app3: ──●──●──●──●──●──  (fast, 5ms each)
```

### Observation
- app1 and app3 handle requests quickly
- app2 creates a queue, slowing down 1/3 of all requests
- Overall latency increases because of one slow server

---

## Key Learnings

### 1. Load Balancing Basics
- **Round Robin** distributes requests evenly (default)
- Each server gets approximately equal traffic
- Good for homogeneous servers (same capacity)

### 2. Nginx as Reverse Proxy
- Sits in front of multiple servers
- Clients only see one endpoint (port 8080)
- Internal Docker network handles communication

### 3. Scaling Benefits
| Metric | Single Server | 3 Servers + Nginx |
|--------|---------------|-------------------|
| Max VUs (no errors) | ~100 | ~300+ |
| Throughput | ~99 req/s | ~297 req/s |
| Fault tolerance | ❌ None | ✅ 2 can fail |

### 4. Round Robin Limitations
- Doesn't account for server health/speed
- Slow server can drag down overall performance
- Need smarter algorithms for heterogeneous servers

---

## Commands Used

```bash
# Start all containers
docker compose up --build

# Run load test
k6 run baseline.js

# Stop all containers
docker compose down

# View logs
docker compose logs -f

# Check which containers are running
docker ps
```

---

## Next Steps

### 03 - Advanced Load Balancing (Future)
- **Least Connections** - Send to server with fewest active connections
- **IP Hash** - Same client always goes to same server (sticky sessions)
- **Weighted** - Give more traffic to powerful servers
- **Health Checks** - Remove unhealthy servers from pool

```nginx
upstream backend {
  least_conn;              # ← Use least connections algorithm
  server app1:3000 weight=3;
  server app2:3000 weight=1;
  server app3:3000 weight=2;
}
```