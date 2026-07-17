import { Controller, Get, Post } from '@nestjs/common';
import { NewsService } from './news.service';

@Controller('news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  list() {
    return this.news.listPublished();
  }

  @Post('seed')
  seed() {
    return this.news.seed();
  }
}
