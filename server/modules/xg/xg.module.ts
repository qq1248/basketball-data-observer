import { Module } from '@nestjs/common';
import { XgProxyService } from './xg-proxy.service';
import { XgEspnExtractorService } from './xg-espn-extractor.service';

@Module({
  providers: [XgProxyService, XgEspnExtractorService],
  exports: [XgProxyService, XgEspnExtractorService],
})
export class XgModule {}
