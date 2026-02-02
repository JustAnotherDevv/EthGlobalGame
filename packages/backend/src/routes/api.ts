import { Router } from 'express';

const router = Router();

// Example API endpoint
router.get('/hello', (req, res) => {
  res.json({
    message: 'Hello from ETHGlobal HackMoney backend!',
    timestamp: new Date().toISOString(),
  });
});

// Add more API routes here
// router.post('/users', createUser);
// router.get('/users/:id', getUser);
// etc.

export default router;
