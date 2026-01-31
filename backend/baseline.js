// import http from 'k6/http';
// import { sleep } from 'k6';

// export const options = {
//   vus: 300,          // virtual users
//   duration: '30s', // test duration
// };

export default function () {
  http.get('http://localhost:9000/users');
  sleep(1);
}

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
  const res = http.get('http://localhost:8080/users'); // <-- NGINX

  const body = JSON.parse(res.body);
  const server = body.server;
 
  // Increment the appropriate counter
  if (server === 'app1') app1Counter.add(1);
  else if (server === 'app2') app2Counter.add(1);
  else if (server === 'app3') app3Counter.add(1);

  sleep(1);
}

