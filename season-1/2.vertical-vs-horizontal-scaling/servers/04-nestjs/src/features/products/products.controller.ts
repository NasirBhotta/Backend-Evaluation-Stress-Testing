import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Product } from './products.model.js';
import * as validate from './products.validation.js';
import { enqueueIngest, getIngestStats } from './products.ingest.js';
import { httpError } from '../../shared/error.js';
import { parseLimit, parsePage, buildCursorFilter, buildNextCursor } from '../../shared/pagination.js';

const buildListFilter = (query: Record<string, unknown>): Record<string, unknown> => {
  const filter: Record<string, unknown> = {};
  if (typeof query.category === 'string' && query.category.trim()) {
    filter.category = query.category.trim();
  }
  if (typeof query.name === 'string' && query.name.trim()) {
    const term = query.name.trim().replace(/"/g, '');
    if (term) filter.$text = { $search: term };
  }
  return filter;
};

@Controller('products')
export class ProductsController {
  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const limit = parseLimit(query.limit);
    const baseFilter = buildListFilter(query);

    if (query.page !== undefined) {
      const page = parsePage(query.page);
      const skip = (page - 1) * limit;
      const hasFilter = Object.keys(baseFilter).length > 0;
      const [items, totalItems] = await Promise.all([
        Product.find(baseFilter).sort({ _id: 1 }).skip(skip).limit(limit).lean(),
        // hasFilter ? Product.countDocuments(baseFilter) : Product.estimatedDocumentCount(),
        Product.estimatedDocumentCount()
      ]);
      return {
        items,
        page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
      };
    }

    const filter = { ...baseFilter, ...buildCursorFilter(query.cursor) };
    const items = await Product.find(filter).sort({ _id: 1 }).limit(limit).lean();
    return { items, nextCursor: buildNextCursor(items, limit) };
  }

  @Get('ingest/stats')
  ingestStats() {
    return getIngestStats();
  }

  @Post('ingest')
  @HttpCode(202)
  ingest(@Body() body: unknown) {
    const payload = validate.validateCreate(body);
    enqueueIngest(payload);
    return { accepted: true };
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    const product = await Product.findById(id).lean();
    if (!product) throw httpError(404, 'Product not found');
    return product;
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const payload = validate.validateCreate(body);
    return Product.create(payload);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const patch = validate.validateUpdate(body);
    const product = await Product.findByIdAndUpdate(id, patch, {
      new: true,
      runValidators: true,
    });
    if (!product) throw httpError(404, 'Product not found');
    return product;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const product = await Product.findByIdAndDelete(id);
    if (!product) throw httpError(404, 'Product not found');
    return { deleted: product };
  }
}
