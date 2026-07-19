import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import testRoutes from './routes/test.js';
import novelRoutes from './routes/novels.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Welcome to the Express Backend!');
});

// Mount routes
app.use('/api', testRoutes);
app.use('/api/novel', novelRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
