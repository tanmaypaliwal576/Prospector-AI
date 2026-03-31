let SYSTEM_CREDITS = 100;

export const getCredits = () => SYSTEM_CREDITS;

export const deductCredits = (amount) => {
  if (SYSTEM_CREDITS < amount) return false;

  SYSTEM_CREDITS -= amount;
  return true;
};

export const addCredits = (amount) => {
  SYSTEM_CREDITS += amount;
};