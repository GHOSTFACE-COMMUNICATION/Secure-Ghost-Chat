import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cryptoRouter from "./crypto";
import walletRouter from "./wallet";
import tokensRouter from "./tokens";
import prekeysRouter from "./prekeys";
import messagesRouter from "./messages";
import numbersRouter from "./numbers";
import invitesRouter from "./invites";
import iceConfigRouter from "./iceConfig";
import blobsRouter from "./blobs";
import integrityRouter from "./integrity";
import pushRouter from "./push";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cryptoRouter);
router.use(walletRouter);
router.use(tokensRouter);
router.use(prekeysRouter);
router.use(messagesRouter);
router.use(numbersRouter);
router.use(invitesRouter);
router.use(iceConfigRouter);
router.use(blobsRouter);
router.use(integrityRouter);
router.use(pushRouter);

export default router;
