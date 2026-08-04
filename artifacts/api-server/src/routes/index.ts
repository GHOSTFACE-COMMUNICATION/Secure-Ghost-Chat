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
import callPushRouter from "./callPush";
import pushHealthRouter from "./pushHealth";
import adminRouter from "./admin";

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
router.use(callPushRouter);
router.use(pushHealthRouter);
router.use(adminRouter);

export default router;
