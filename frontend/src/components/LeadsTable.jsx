const LeadsTable = ({ leads, pagination }) => {
  return (
    <div>
      <table className="w-full text-left border">
        <thead className="bg-gray-200">
          <tr>
            <th className="p-2">Name</th>
            <th>Website</th>
            <th>Phone</th>
            <th>Quality</th>
          </tr>
        </thead>

        <tbody>
          {leads.map((lead) => (
            <tr key={lead._id} className="border-t">
              <td className="p-2">{lead.name}</td>

              <td>
                <a
                  href={lead.website}
                  target="_blank"
                  className="text-blue-500"
                >
                  Visit
                </a>
              </td>

              <td>{lead.phone}</td>

              <td>
                <span className="px-2 py-1 bg-green-200 rounded">
                  {lead.leadQuality}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 text-center">
        Page {pagination.page} / {pagination.pages}
      </div>
    </div>
  );
};

export default LeadsTable;