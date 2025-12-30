import { eq } from "drizzle-orm";
import { database } from "../db/db.js";
import { users } from "../db/schema.js"
import bcrypt from "bcrypt";

export const register = async (req: any, res: any) => {
  const { name, email, password } = req.body;

  const userExists = await database
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (userExists.length > 0) {
    return res.status(400).json({ message: "Email already exists" });
  };

  // Hash password 
  const salt = await bcrypt.genSalt(10)
  const hashedPassword = await bcrypt.hash(password, salt);

  //create user 
  await database.insert(users).values({
    id: crypto.randomUUID(),
    name,
    email,
    password: hashedPassword
  })

  res.status(201).json({ message: `Thanks for signing up ${name}` })

}

