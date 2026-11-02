import express from 'express';
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ status: 'success', message: 'Endpoint de búsqueda activo' });
});

export default router;
