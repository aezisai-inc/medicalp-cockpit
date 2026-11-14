import { Module } from "@nestjs/common";
import { VisionController } from "./vision/vision.controller";
import { AuditController } from "./audit/audit.controller";
import { CopyController } from "./copy/copy.controller";
import { DocsController } from "./docs/docs.controller";
import { HealthController } from "./health.controller";

@Module({
  controllers: [
    HealthController,
    VisionController,
    AuditController,
    CopyController,
    DocsController,
  ],
})
export class AppModule {}
