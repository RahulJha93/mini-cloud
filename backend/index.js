const express = require('express');
const app = express();
const PORT = process.env.PORT || 9000;

// Middleware to parse JSON bodies
app.use(express.json());

// In-memory users array
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

  // Make ONLY app2 slow
  if (process.env.SERVER_NAME === 'app2') {
    await new Promise(resolve => setTimeout(resolve, 3000)); // 3 seconds
  }

  res.status(200).json({
    success: true,
    server: process.env.SERVER_NAME,
    time: Date.now(),
    count: users.length,
    data: users
  });
});

// POST /users - Create a new user
app.post('/users', (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({
      success: false,
      message: 'Please provide name and email'
    });
  }

  const newUser = {
    id: users.length + 1,
    name,
    email
  };

  users.push(newUser);

  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: newUser
  });
});

// GET /compute - Simulate a CPU-intensive task
app.get('/compute', (req, res) => {
  let total = 0;
  for (let i = 0; i < 1e7; i++) {
    total += i;
  }
  res.json({ success: true, total });
});


// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
