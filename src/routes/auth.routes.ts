import express from "express";
import { register } from "../controllers/auth.controller.js"

const router = express.Router();

router.post("/resgister", register);

export default router;
