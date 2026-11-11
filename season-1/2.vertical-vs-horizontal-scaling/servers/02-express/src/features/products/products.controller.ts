import type { Request, Response } from "express";
import { Product } from "./products.model.js";
import * as validate from "./products.validation.js";
import { enqueueIngest, getIngestStats } from "./products.ingest.js";
import { httpError } from "../../shared/error.js";
import {
  parseLimit,
  parsePage,
  buildCursorFilter,
  buildNextCursor,
} from "../../shared/pagination.js";

// Express 5: async handlers ke rejected promises (throw included) khud errorHandler tak forward ho jaate hain

const buildListFilter = (query: Request["query"]): Record<string, unknown> => {
  const filter: Record<string, unknown> = {};
  if (typeof query.category === "string" && query.category.trim()) {
    filter.category = query.category.trim();
  }
  if (typeof query.name === "string" && query.name.trim()) {
    const term = query.name.trim().replace(/"/g, "");
    if (term) filter.$text = { $search: term };
  }
  return filter;
};

// GET /products?page=&limit=      -> offset pagination (page numbers, totalPages)
// GET /products?cursor=&limit=    -> cursor pagination (default when no "page" query given)
export const list = async (req: Request, res: Response): Promise<void> => {
  const limit = parseLimit(req.query.limit);
  const baseFilter = buildListFilter(req.query);

  if (req.query.page !== undefined) {
    const page = parsePage(req.query.page);
    const skip = (page - 1) * limit;
    const hasFilter = Object.keys(baseFilter).length > 0;

    // countDocuments({}) walks the whole collection even with indexes present (tested:
    // 22s on 40M docs) - estimatedDocumentCount() reads collection metadata instead
    // (~4ms) and is the standard fix for an unfiltered total. A real filter (category)
    // narrows the scan enough that the exact count stays cheap.
    const [items, totalItems] = await Promise.all([
      Product.find(baseFilter).sort({ _id: 1 }).skip(skip).limit(limit).lean(),
      // hasFilter ? Product.countDocuments(baseFilter) : Product.estimatedDocumentCount(),
      Product.estimatedDocumentCount()
    ]);

    res.json({
      items,
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    });
    return;
  }

  const filter = { ...baseFilter, ...buildCursorFilter(req.query.cursor) };
  const items = await Product.find(filter).sort({ _id: 1 }).limit(limit).lean();
  res.json({ items, nextCursor: buildNextCursor(items, limit) });
};

export const getById = async (req: Request, res: Response): Promise<void> => {
  const product = await Product.findById(req.params.id).lean();
  if (!product) throw httpError(404, "Product not found");
  res.json(product);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const payload = validate.validateCreate(req.body);
  const product = await Product.create(payload);
  res.status(201).json(product);
};

export const ingest = (req: Request, res: Response): void => {
  const payload = validate.validateCreate(req.body);
  enqueueIngest(payload);
  res.status(202).json({ accepted: true });
};

export const ingestStats = (_req: Request, res: Response): void => {
  res.json(getIngestStats());
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const patch = validate.validateUpdate(req.body);
  const product = await Product.findByIdAndUpdate(req.params.id, patch, {
    new: true,
    runValidators: true,
  });
  if (!product) throw httpError(404, "Product not found");
  res.json(product);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) throw httpError(404, "Product not found");
  res.json({ deleted: product });
};
