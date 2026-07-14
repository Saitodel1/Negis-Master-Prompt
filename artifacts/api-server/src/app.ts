import express, { type Express } from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import type { IncomingMessage, ServerResponse } from "node:http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? 'https://crm.negis.online,http://localhost:5173')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: IncomingMessage) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: ServerResponse) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
