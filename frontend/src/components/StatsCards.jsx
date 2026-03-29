const StatsCards = ({ stats }) => {
  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      <div className="bg-white p-4 rounded-xl shadow text-center">
        <p className="text-gray-500">Total</p>
        <h2 className="text-xl font-bold">{stats.total || 0}</h2>
      </div>

      <div className="bg-green-100 p-4 rounded-xl text-center">
        <p>High</p>
        <h2 className="text-xl font-bold">{stats.High || 0}</h2>
      </div>

      <div className="bg-yellow-100 p-4 rounded-xl text-center">
        <p>Medium</p>
        <h2>{stats.Medium || 0}</h2>
      </div>

      <div className="bg-red-100 p-4 rounded-xl text-center">
        <p>Low</p>
        <h2>{stats.Low || 0}</h2>
      </div>
    </div>
  );
};

export default StatsCards;