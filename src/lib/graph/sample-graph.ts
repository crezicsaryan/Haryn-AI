import type {
  EdgeConfidence,
  GraphEdge,
  GraphEdgeType,
  GraphNode,
  GraphNodeType,
} from "./types";

/**
 * The bundled sample report's knowledge graph.
 *
 * The sample is a code-level fixture — it is never analysed, so it has no rows
 * and its graph view reported "no graph for this repository". This is the same
 * kind of fixture as the sample report itself: a small, hand-written slice of a
 * repository whose shape is known by construction.
 *
 * It is deliberately hand-written rather than generated. Every node and edge
 * here is meant to be read by someone evaluating the product, so it has to look
 * like a real codebase — an API layer, a service layer, models, routes, packages
 * and one test — and the relationships have to be the ones a parser would find.
 */

type NodeSpec = [id: string, type: GraphNodeType, name: string, file: string | null, line?: number];

const NODES: NodeSpec[] = [
  ["repo", "repository", "acme/ecommerce", null],
  ["d_src", "directory", "src", null],
  ["d_api", "directory", "api", null],
  ["d_models", "directory", "models", null],
  ["d_services", "directory", "services", null],
  ["d_middleware", "directory", "middleware", null],
  ["d_tests", "directory", "tests", null],

  ["f_server", "file", "server.js", "src/server.js", 1],
  ["f_orders_api", "file", "orders.js", "src/api/orders.js", 1],
  ["f_users_api", "file", "users.js", "src/api/users.js", 1],
  ["f_payment_api", "file", "payment.js", "src/api/payment.js", 1],
  ["f_order_model", "file", "order.js", "src/models/order.js", 1],
  ["f_user_model", "file", "user.js", "src/models/user.js", 1],
  ["f_order_service", "file", "orderService.js", "src/services/orderService.js", 1],
  ["f_payment_service", "file", "paymentService.js", "src/services/paymentService.js", 1],
  ["f_auth", "file", "auth.js", "src/middleware/auth.js", 1],
  ["f_orders_test", "file", "orders.test.js", "tests/orders.test.js", 1],

  ["fn_createOrder", "function", "createOrder", "src/services/orderService.js", 24],
  ["fn_listOrders", "function", "listOrders", "src/services/orderService.js", 58],
  ["fn_computeTotals", "function", "computeTotals", "src/services/orderService.js", 91],
  ["fn_chargeCard", "function", "chargeCard", "src/services/paymentService.js", 18],
  ["fn_refund", "function", "refund", "src/services/paymentService.js", 47],
  ["fn_requireAuth", "middleware", "requireAuth", "src/middleware/auth.js", 12],
  ["fn_signToken", "function", "signToken", "src/middleware/auth.js", 39],
  ["fn_validateCart", "function", "validateCart", "src/models/order.js", 66],

  ["cls_OrderService", "class", "OrderService", "src/services/orderService.js", 8],
  ["cls_PaymentClient", "class", "PaymentClient", "src/services/paymentService.js", 6],

  ["mdl_Order", "db_model", "Order", "src/models/order.js", 9],
  ["mdl_User", "db_model", "User", "src/models/user.js", 7],
  ["mdl_Payment", "db_model", "Payment", "src/models/payment.js", 6],

  ["r_post_orders", "api_endpoint", "POST /api/orders", "src/api/orders.js", 14],
  ["r_get_orders", "api_endpoint", "GET /api/orders", "src/api/orders.js", 31],
  ["r_post_payment", "api_endpoint", "POST /api/payment", "src/api/payment.js", 12],
  ["r_get_user", "api_endpoint", "GET /api/users/:id", "src/api/users.js", 10],

  ["pkg_express", "package", "express", "package.json"],
  ["pkg_stripe", "package", "stripe", "package.json"],
  ["pkg_jsonwebtoken", "package", "jsonwebtoken", "package.json"],

  ["env_stripe", "env_var", "STRIPE_SECRET_KEY", "src/services/paymentService.js", 11],
  ["env_jwt", "env_var", "JWT_SECRET", "src/middleware/auth.js", 7],

  ["t_orders", "test", "orders.test.js", "tests/orders.test.js", 1],
];

/** [source, target, relationship, confidence, evidence] */
type EdgeSpec = [string, string, GraphEdgeType, EdgeConfidence, string];

const EDGES: EdgeSpec[] = [
  ["repo", "d_src", "CONTAINS", "confirmed", "directory listing"],
  ["d_src", "d_api", "CONTAINS", "confirmed", "directory listing"],
  ["d_src", "d_models", "CONTAINS", "confirmed", "directory listing"],
  ["d_src", "d_services", "CONTAINS", "confirmed", "directory listing"],
  ["d_src", "d_middleware", "CONTAINS", "confirmed", "directory listing"],
  ["d_src", "f_server", "CONTAINS", "confirmed", "file path"],
  ["d_api", "f_orders_api", "CONTAINS", "confirmed", "file path"],
  ["d_api", "f_users_api", "CONTAINS", "confirmed", "file path"],
  ["d_api", "f_payment_api", "CONTAINS", "confirmed", "file path"],
  ["d_models", "f_order_model", "CONTAINS", "confirmed", "file path"],
  ["d_models", "f_user_model", "CONTAINS", "confirmed", "file path"],
  ["d_services", "f_order_service", "CONTAINS", "confirmed", "file path"],
  ["d_services", "f_payment_service", "CONTAINS", "confirmed", "file path"],
  ["d_middleware", "f_auth", "CONTAINS", "confirmed", "file path"],
  ["d_tests", "f_orders_test", "CONTAINS", "confirmed", "file path"],

  ["f_server", "f_orders_api", "IMPORTS", "confirmed", 'import orders from "./api/orders"'],
  ["f_server", "f_users_api", "IMPORTS", "confirmed", 'import users from "./api/users"'],
  ["f_server", "f_payment_api", "IMPORTS", "confirmed", 'import payment from "./api/payment"'],
  ["f_orders_api", "f_order_service", "IMPORTS", "confirmed", 'import { createOrder } from "../services/orderService"'],
  ["f_order_service", "f_order_model", "IMPORTS", "confirmed", 'import { Order } from "../models/order"'],
  ["f_order_service", "f_payment_service", "IMPORTS", "confirmed", 'import { chargeCard } from "./paymentService"'],
  ["f_payment_service", "pkg_stripe", "DEPENDS_ON", "confirmed", 'import Stripe from "stripe"'],
  ["f_auth", "pkg_jsonwebtoken", "DEPENDS_ON", "confirmed", 'import jwt from "jsonwebtoken"'],
  ["f_server", "pkg_express", "DEPENDS_ON", "confirmed", 'import express from "express"'],
  ["f_orders_test", "f_order_service", "IMPORTS", "confirmed", 'import { createOrder } from "../src/services/orderService"'],

  ["f_order_service", "cls_OrderService", "DEFINES", "confirmed", "class declaration"],
  ["f_payment_service", "cls_PaymentClient", "DEFINES", "confirmed", "class declaration"],
  ["f_order_service", "fn_createOrder", "DEFINES", "confirmed", "function declaration"],
  ["f_order_service", "fn_listOrders", "DEFINES", "confirmed", "function declaration"],
  ["f_order_service", "fn_computeTotals", "DEFINES", "confirmed", "function declaration"],
  ["f_payment_service", "fn_chargeCard", "DEFINES", "confirmed", "function declaration"],
  ["f_payment_service", "fn_refund", "DEFINES", "confirmed", "function declaration"],
  ["f_auth", "fn_requireAuth", "DEFINES", "confirmed", "function declaration"],
  ["f_auth", "fn_signToken", "DEFINES", "confirmed", "function declaration"],
  ["f_order_model", "fn_validateCart", "DEFINES", "confirmed", "function declaration"],
  ["f_order_model", "mdl_Order", "DEFINES", "confirmed", "model declaration"],
  ["f_user_model", "mdl_User", "DEFINES", "confirmed", "model declaration"],

  ["f_order_service", "fn_createOrder", "EXPORTS", "confirmed", "export declaration"],
  ["f_order_service", "cls_OrderService", "EXPORTS", "confirmed", "export declaration"],
  ["f_payment_service", "fn_chargeCard", "EXPORTS", "confirmed", "export declaration"],
  ["f_auth", "fn_requireAuth", "EXPORTS", "confirmed", "export declaration"],

  ["fn_createOrder", "fn_validateCart", "CALLS", "confirmed", "validateCart(cart)"],
  ["fn_createOrder", "fn_computeTotals", "CALLS", "confirmed", "computeTotals(items)"],
  ["fn_createOrder", "fn_chargeCard", "CALLS", "confirmed", "await chargeCard(order)"],
  ["fn_listOrders", "fn_computeTotals", "CALLS", "confirmed", "computeTotals(row.items)"],
  ["fn_chargeCard", "cls_PaymentClient", "USES", "inferred", "new PaymentClient(key)"],
  ["fn_chargeCard", "env_stripe", "READS", "confirmed", "process.env.STRIPE_SECRET_KEY"],
  ["fn_signToken", "env_jwt", "READS", "confirmed", "process.env.JWT_SECRET"],
  ["fn_refund", "mdl_Payment", "WRITES", "inferred", "Payment.update(...)"],
  ["fn_createOrder", "mdl_Order", "WRITES", "confirmed", "Order.create({...})"],
  ["fn_listOrders", "mdl_Order", "QUERIES", "confirmed", "Order.findMany()"],

  ["r_post_orders", "fn_createOrder", "EXPOSES_ROUTE", "confirmed", 'router.post("/api/orders", createOrder)'],
  ["r_get_orders", "fn_listOrders", "EXPOSES_ROUTE", "confirmed", 'router.get("/api/orders", listOrders)'],
  ["r_post_payment", "fn_chargeCard", "EXPOSES_ROUTE", "confirmed", 'router.post("/api/payment", chargeCard)'],
  ["r_get_user", "fn_requireAuth", "USES", "confirmed", "router.get(path, requireAuth, handler)"],
  ["f_orders_api", "r_post_orders", "EXPOSES_ROUTE", "confirmed", "route registration"],
  ["f_orders_api", "r_get_orders", "EXPOSES_ROUTE", "confirmed", "route registration"],
  ["f_payment_api", "r_post_payment", "EXPOSES_ROUTE", "confirmed", "route registration"],
  ["f_users_api", "r_get_user", "EXPOSES_ROUTE", "confirmed", "route registration"],

  ["t_orders", "fn_createOrder", "TESTS", "confirmed", "describe('createOrder')"],
  ["f_orders_test", "t_orders", "DEFINES", "confirmed", "test file"],
  ["t_orders", "fn_computeTotals", "TESTS", "inferred", "name match"],
];

/**
 * Build the fixture for one analysis id.
 *
 * Ids are namespaced by the analysis so this graph cannot collide with a real
 * one, and so the composite `(analysis_id, id)` key stays meaningful.
 */
export function sampleGraph(analysisId: string): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodes: GraphNode[] = NODES.map(([id, nodeType, name, filePath, line]) => ({
    id: `${analysisId}_${id}`,
    analysisId,
    nodeType,
    name,
    filePath,
    startLine: line ?? null,
    endLine: line ?? null,
    language: filePath?.endsWith(".js") || filePath?.endsWith(".jsx") ? "JavaScript" : null,
    metadata: {},
  }));

  const edges: GraphEdge[] = EDGES.map(([from, to, relationshipType, confidence, evidence], i) => ({
    id: `${analysisId}_e${i}`,
    analysisId,
    sourceNodeId: `${analysisId}_${from}`,
    targetNodeId: `${analysisId}_${to}`,
    relationshipType,
    confidence,
    evidence,
  }));

  return { nodes, edges };
}

/** Summary counts, matching the shape the pipeline writes onto a report. */
export function sampleGraphSummary() {
  const byNodeType: Record<string, number> = {};
  for (const [, nodeType] of NODES) {
    byNodeType[nodeType] = (byNodeType[nodeType] ?? 0) + 1;
  }
  const byEdgeType: Record<string, number> = {};
  for (const [, , relationshipType] of EDGES) {
    byEdgeType[relationshipType] = (byEdgeType[relationshipType] ?? 0) + 1;
  }
  return {
    nodeCount: NODES.length,
    edgeCount: EDGES.length,
    byNodeType,
    byEdgeType,
    parsedFiles: 9,
    skippedFiles: 0,
    truncated: false,
  };
}
