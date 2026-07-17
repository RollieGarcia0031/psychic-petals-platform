import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import testRoutes from './routes/test.js';

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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
