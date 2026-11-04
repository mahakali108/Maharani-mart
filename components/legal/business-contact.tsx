/** Owner-provided public business details; independently verify before publication. */
export function BusinessContact({ officer = false }: { officer?: boolean }) {
  return (
    <address className="not-italic leading-7">
      {officer ? <p><strong>Grievance Officer:</strong> AJAY KUMAR, Proprietor</p> : <p><strong>Proprietor:</strong> AJAY KUMAR</p>}
      <p><strong>Registered trade name:</strong> AJAY GENERAL</p>
      <p><strong>Brand:</strong> MAHARANI TRADERS</p>
      <p><strong>Address:</strong> Plot No. 231, Ander Bazar, Belaganj, Gaya, Bihar – 804403</p>
      <p><strong>Phone:</strong> <a href="tel:8987023959" className="break-words font-semibold text-primary-700 underline">8987023959</a></p>
      <p><strong>Email:</strong> <a href="mailto:adinathsahu8987@gmail.com" className="break-all font-semibold text-primary-700 underline">adinathsahu8987@gmail.com</a></p>
    </address>
  );
}
