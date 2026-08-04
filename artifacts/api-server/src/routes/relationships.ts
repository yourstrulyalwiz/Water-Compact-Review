import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/relationships", async (req, res): Promise<void> => {
  const { candidateId } = req.query as { candidateId?: string };

  let result;
  if (candidateId) {
    result = await pool.query(
      `SELECT * FROM item_relationships 
       WHERE source_candidate_id = $1 OR target_candidate_id = $1
       ORDER BY relationship_id`,
      [candidateId],
    );
  } else {
    result = await pool.query(
      "SELECT * FROM item_relationships ORDER BY relationship_id",
    );
  }

  res.json(result.rows);
});

export default router;
