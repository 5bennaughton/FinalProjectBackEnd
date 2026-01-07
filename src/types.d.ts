import 'express';

declare module 'express' {
  interface Request {
    user?: { // Make the user property optional
      id: string;
    };
  }
}